/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - STATE MACHINE & GAME LOOP MANAGER
 * =========================================================================
 * Bộ điều phối luồng vòng lặp trận đấu (Game Loop Manager). Quản lý đồng hồ
 * đếm ngược thời gian, bầu Trưởng Làng, bỏ phiếu xử án treo cổ, xử tử,
 * chuyển pha Đêm/Ngày kết hợp TickEngine và kiểm tra Điều kiện Chiến Thắng.
 */

import { db, ref, get, set, update, runTransaction } from "./firebase-config.js";
import { Engine_Module, getRoleName } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";
import { runGavelStrikeAnimation, showToast, playSFX, playBGM, openHunterRevengeModal } from "./ui-manager.js";

// BẢO VỆ KHÓA TRẠNG THÁI CỤC BỘ (CHỐNG LẶP LỆNH BẤT ĐỒNG BỘ)
let isTransitioning = false;
let isResolvingVote = false;
let localTimerInterval = null;

// BẢNG VAI TRÒ THỤ ĐỘNG BAN ĐÊM (TỰ ĐỘNG KẾT THÚC LƯỢT KHI VÀO ĐÊM)
const PASSIVE_NIGHT_ROLES = [
    "villager", "clown", "idiot", "ghost", "halfWolf", "apprenticeSeer", 
    "doppelganger", "lostChild", "headlessKnight", "paradox", "fugitive", 
    "cryptoMiner", "reverser", "glitch", "sovereign", "ember", "traitor", 
    "blackDeath", "loneWolf", "chaosWolf", "bloodline", "ashenKnight"
];

// THỜI LƯỢNG ĐẾM NGƯỢC MẶC ĐỊNH CHO TỪNG PHA (GIÂY)
const DEFAULT_PHASE_DURATIONS = {
    night: 60,
    day_discussion: 90,
    mayor_election: 45,
    defense: 30,
    vote: 30
};

export const StateMachine = {
    // ==========================================
    // 1. QUẢN LÝ ĐỒNG HỒ ĐẾM NGƯỢC THỜI GIAN THEO PHA
    // ==========================================
    
    /**
     * Bắt đầu đếm ngược thời gian pha và đồng bộ hóa lên Firebase
     * @param {number} durationSeconds - Số giây đếm ngược
     */
    async startPhaseTimer(durationSeconds) {
        const Net = window.Net;
        if (!Net || !Net.roomId || !Net.isHost) return;

        const endTime = Date.now() + (durationSeconds * 1000);
        try {
            await update(ref(db, `rooms/${Net.roomId}/meta`), {
                timerEndTime: endTime,
                timerDuration: durationSeconds
            });
        } catch (err) {
            console.error("Lỗi khi khởi chạy đồng hồ đếm ngược pha:", err);
        }
    },

    /**
     * Đồng bộ hóa giao diện thanh đếm ngược thời gian ở client
     * @param {number} endTime - Thời điểm hết giờ (Timestamp ms)
     * @param {number} duration - Tổng thời lượng pha (Giây)
     */
    syncPhaseTimer(endTime, duration) {
        if (localTimerInterval) clearInterval(localTimerInterval);

        const display = document.getElementById("phase-timer-display");
        const bar = document.getElementById("phase-timer-bar");

        if (!display || !bar || !endTime) return;

        const updateVisuals = () => {
            const now = Date.now();
            const remainingMs = Math.max(0, endTime - now);
            const remainingSec = Math.ceil(remainingMs / 1000);

            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            display.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

            const percentage = Math.max(0, (remainingMs / (duration * 1000)) * 100);
            bar.style.width = `${percentage}%`;

            if (remainingSec <= 10) {
                display.style.color = "var(--danger)";
                bar.style.background = "var(--danger)";
                bar.style.boxShadow = "0 0 10px var(--danger-glow)";
            } else {
                display.style.color = "var(--accent)";
                bar.style.background = "var(--accent)";
                bar.style.boxShadow = "0 0 8px var(--accent-glow)";
            }

            // Tự động kích hoạt chuyển pha khi hết giờ (Chỉ dành cho máy Quản trò/Host)
            if (remainingMs <= 0) {
                clearInterval(localTimerInterval);
                if (window.Net && window.Net.isHost) {
                    StateMachine.handleTimerExpiration();
                }
            }
        };

        updateVisuals();
        localTimerInterval = setInterval(updateVisuals, 1000);
    },

    /**
     * Xử lý hành động tự động khi hết giờ từng pha
     */
    async handleTimerExpiration() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        const roomRef = ref(db, `rooms/${Net.roomId}`);
        const snap = await get(roomRef);
        if (!snap.exists()) return;

        const roomData = snap.val();
        const phase = roomData.meta?.phase;
        const trialStage = roomData.trial?.stage;

        if (phase === "night") {
            showToast("Đã hết thời gian Đêm đen! Tự động chuyển sang Ban Ngày...", "warning");
            await StateMachine.transitionToDay();
        } else if (phase === "day") {
            if (trialStage === "mayor_election") {
                await StateMachine.resolveMayorElection();
            } else if (trialStage === "defense") {
                // Hết giờ biện hộ -> Tự động chuyển sang Bỏ phiếu phán quyết
                await update(ref(db, `rooms/${Net.roomId}/trial`), { stage: "vote" });
                StateMachine.startPhaseTimer(DEFAULT_PHASE_DURATIONS.vote);
            } else if (trialStage === "vote") {
                await StateMachine.resolveVotingOutcome();
            }
        }
    },

    // ==========================================
    // 2. BẦU CHỌN VÀ CHUYỂN GIAO TRƯỞNG LÀNG
    // ==========================================
    
    /**
     * Khởi chạy cuộc trưng cầu dân ý bầu Trưởng Làng
     */
    async startMayorElection() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            await update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "mayor_election",
                accusedId: null
            });
            await update(ref(db, `rooms/${Net.roomId}/mayor_votes`), null);
            
            StateMachine.startPhaseTimer(DEFAULT_PHASE_DURATIONS.mayor_election);
            await Engine_Module.logMsg("👑 Cuộc trưng cầu dân ý bầu chọn TRƯỞNG LÀNG chính thức bắt đầu!", "info");
        } catch (err) {
            console.error("Lỗi khởi tạo bầu Trưởng Làng:", err);
        }
    },

    /**
     * Chốt kết quả bầu chọn Trưởng Làng
     */
    async resolveMayorElection() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        const roomRef = ref(db, `rooms/${Net.roomId}`);
        const snap = await get(roomRef);
        if (!snap.exists()) return;

        const roomData = snap.val();
        const votes = roomData.mayor_votes || {};
        const voteCounts = {};

        Object.values(votes).forEach(candidateId => {
            if (candidateId && candidateId !== "skip") {
                voteCounts[candidateId] = (voteCounts[candidateId] || 0) + 1;
            }
        });

        let winnerId = null;
        let maxVotes = 0;

        Object.entries(voteCounts).forEach(([candId, count]) => {
            if (count > maxVotes) {
                maxVotes = count;
                winnerId = candId;
            }
        });

        const updates = {
            [`rooms/${Net.roomId}/trial`]: { stage: "none", accusedId: null },
            [`rooms/${Net.roomId}/mayor_votes`]: null
        };

        if (winnerId && roomData.players[winnerId]) {
            updates[`rooms/${Net.roomId}/meta/mayorId`] = winnerId;
            await update(ref(db), updates);
            await Engine_Module.logMsg(`👑 Thần dân [${roomData.players[winnerId].name}] đã trúng cử chức vị TRƯỞNG LÀNG!`, "info");
        } else {
            await update(ref(db), updates);
            await Engine_Module.logMsg("👑 Cuộc bầu chọn hòa hoặc không đủ phiếu. Vương quốc tạm thời vắng Trưởng Làng!", "sys");
        }

        const dayDuration = roomData.settings?.dayDuration || DEFAULT_PHASE_DURATIONS.day_discussion;
        StateMachine.startPhaseTimer(dayDuration);
    },

    /**
     * Chuyển giao vương miện Trưởng Làng cho người khác khi tử vong
     * @param {string} newMayorId - ID của Trưởng Làng kế vị
     */
    async passMayorTitle(newMayorId) {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players/${newMayorId}`));
            if (snap.exists()) {
                await update(ref(db, `rooms/${Net.roomId}/meta`), { mayorId: newMayorId });
                await Engine_Module.logMsg(`👑 Chức vị Trưởng Làng đã được di ngôn trao lại cho [${snap.val().name}]!`, "info");
            }
        } catch (err) {
            console.error("Lỗi chuyển giao chức Trưởng Làng:", err);
        }
    },

    // ==========================================
    // 3. CHUYỂN SANG PHA ĐÊM (NIGHT TRANSITION)
    // ==========================================
    
    /**
     * Chuyển sang Pha Đêm Đen
     */
    async transitionToNight() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        isTransitioning = true;
        
        try {
            let success = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/meta`), (meta) => {
                if (!meta) return meta;
                if (meta.phase === "night") return; 
                meta.phase = "night";
                meta.day = (meta.day || 0) + 1;
                success = true;
                return meta;
            });

            if (!success) {
                isTransitioning = false;
                return;
            }

            playSFX("night_howl");
            playBGM("night_bgm");

            const snap = await get(ref(db, `rooms/${Net.roomId}`));
            if (snap.exists()) {
                const roomData = snap.val();
                const players = roomData.players || {};
                const updates = {};
                
                // Dọn dẹp dữ liệu bỏ phiếu ban ngày
                updates[`rooms/${Net.roomId}/votes`] = null;
                updates[`rooms/${Net.roomId}/nominations`] = null;
                updates[`rooms/${Net.roomId}/trial`] = {
                    stage: "none",
                    accusedId: null,
                    accusedText: "",
                    decisionText: ""
                };

                // Khởi tạo lại lượt đi đêm cho các người chơi
                Object.entries(players).forEach(([playerId, player]) => {
                    updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                    
                    // Người đã chết, mất kết nối, hoặc vai trò thụ động -> Tự động đánh dấu xong lượt
                    if (!player.alive || player.isConnected === false || PASSIVE_NIGHT_ROLES.includes(player.role)) {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                    } else {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false;
                    }
                });

                await update(ref(db), updates);

                const currentDay = roomData.meta?.day || 1;
                await Engine_Module.logMsg(`🌙 Màn đêm đen thứ ${currentDay} buông xuống. Hãy nhắm mắt đi ngủ!`, "sys");

                const nightDuration = roomData.settings?.nightDuration || DEFAULT_PHASE_DURATIONS.night;
                StateMachine.startPhaseTimer(nightDuration);
            }
        } catch (error) {
            console.error("Lỗi khi chuyển pha đêm:", error);
            showToast("Không thể đồng bộ pha đêm!", "danger");
        } finally {
            isTransitioning = false;
        }
    },

    // ==========================================
    // 4. KIỂM TRA ĐỒNG BỘ TỰ ĐỘNG CHUYỂN NGÀY
    // ==========================================
    
    /**
     * Tự động quét kiểm tra nếu tất cả mọi người đã hoàn thành lượt đêm
     */
    async checkAndAutoTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players`));
            if (!snap.exists()) return;
            
            const players = Object.values(snap.val() || {});
            
            // Lọc ra các người chơi còn sống VÀ đang online kết nối
            const activeAlivePlayers = players.filter(p => p.alive && p.isConnected !== false);

            const allTurnsEnded = activeAlivePlayers.every(p => p.turnEnded === true);

            if (allTurnsEnded && activeAlivePlayers.length > 0) {
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi quét trạng thái lượt đêm:", error);
        }
    },

    /**
     * Lệnh cưỡng chế chuyển sang Ban Ngày lập tức từ Quản Trò
     */
    async forceTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;
        
        try {
            await Engine_Module.logMsg("⚠️ Quản trò đã cưỡng chế kết thúc đêm đen sớm!", "kill");
            await StateMachine.transitionToDay();
        } catch (error) {
            console.error("Lỗi cưỡng chế sang ngày:", error);
        }
    },

    // ==========================================
    // 5. CHUYỂN PHA NGÀY & PHÂN GIẢI TICK ENGINE
    // ==========================================
    
    /**
     * Chuyển sang Ban Ngày và kích hoạt TickEngine phân giải đòn đêm
     */
    async transitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        isTransitioning = true;
        
        try {
            let success = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/meta/phase`), (phase) => {
                if (phase === "day") return;
                success = true;
                return "day";
            });

            if (!success) {
                isTransitioning = false;
                return;
            }

            playSFX("morning_rooster");
            playBGM("day_bgm");

            // Phân giải toàn bộ hành động đêm qua TickEngine 8-Tick
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);
            const updates = {};

            // Cập nhật các người chơi tử vong
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Cập nhật trạng thái bùa chú / biến đổi vai trò
            for (const [playerId, fields] of Object.entries(resolutionOutcome.playerStateUpdates)) {
                for (const [fieldKey, val] of Object.entries(fields)) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/${fieldKey}`] = val;
                }
            }

            // Gửi mật thư thông báo vào Hòm Thư Mailbox
            for (const [playerId, mails] of Object.entries(resolutionOutcome.mailboxDeliveries)) {
                for (const mail of mails) {
                    const mailId = "mail_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
                    updates[`rooms/${Net.roomId}/players/${playerId}/mailbox/${mailId}`] = {
                        id: mailId,
                        title: mail.title,
                        content: mail.content,
                        category: mail.category || "role",
                        isRead: false,
                        timestamp: Date.now()
                    };
                }
            }

            await update(ref(db), updates);

            // Công bố tin tức tử vong buổi sáng
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh rạng rỡ! Đêm qua vương quốc bình yên, không ai bị hại.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => Net.players[id]?.name || "Thần dân").join(", ");
                announcement = `☀️ Bình minh rạng rỡ! Đêm qua ghi nhận ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");

            // Bầu Trưởng Làng vào Ngày 1 nếu chưa có Trưởng Làng
            const roomSnap = await get(ref(db, `rooms/${Net.roomId}`));
            const roomData = roomSnap.val() || {};

            if (roomData.meta?.day === 1 && !roomData.meta?.mayorId) {
                await StateMachine.startMayorElection();
            } else {
                const dayDuration = roomData.settings?.dayDuration || DEFAULT_PHASE_DURATIONS.day_discussion;
                StateMachine.startPhaseTimer(dayDuration);
            }

            await StateMachine.checkVictoryConditions();

        } catch (error) {
            console.error("Lỗi phân giải đêm:", error);
            showToast("Có lỗi xảy ra khi tính toán kết quả đêm!", "danger");
        } finally {
            isTransitioning = false;
        }
    },

    // ==========================================
    // 6. PHÁN QUYẾT BỎ PHIẾU TREO CỔ (VOTE RESOLUTION)
    // ==========================================
    
    /**
     * Chốt kết quả bỏ phiếu xử án treo cổ
     */
    async resolveVotingOutcome() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isResolvingVote) return;

        isResolvingVote = true;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}`));
            if (!snap.exists()) {
                isResolvingVote = false;
                return;
            }

            const roomData = snap.val();
            const trial = roomData.trial || { accusedId: null };
            const votes = roomData.votes || {};
            const mayorId = roomData.meta?.mayorId;

            if (!trial.accusedId || trial.stage !== "vote") {
                isResolvingVote = false;
                return;
            }

            let countAcquit = 0;
            let countExecute = 0;

            // Tính toán tổng phiếu bầu (Phiếu của Trưởng Làng tính nhân đôi weight = 2)
            Object.entries(votes).forEach(([voterId, voteValue]) => {
                const voter = roomData.players[voterId];
                if (voter && voter.alive) {
                    const weight = (voterId === mayorId) ? 2 : 1;
                    if (voteValue === "ACQUIT") countAcquit += weight;
                    if (voteValue === "EXECUTE") countExecute += weight;
                }
            });

            const accusedPlayer = roomData.players[trial.accusedId];
            const accusedName = accusedPlayer?.name || "Bị cáo";
            let decisionText = "";
            let executeTarget = false;

            if (countExecute > countAcquit) {
                decisionText = `BẢN ÁN TỬ HÌNH DÀNH CHO: ${accusedName.toUpperCase()}!`;
                executeTarget = true;
            } else {
                decisionText = `${accusedName.toUpperCase()} ĐÃ ĐƯỢC THA BỔNG THÀNH CÔNG!`;
            }

            let allowed = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/trial/stage`), (stage) => {
                if (stage === "verdict") return;
                allowed = true;
                return "verdict";
            });

            if (!allowed) {
                isResolvingVote = false;
                return;
            }

            await update(ref(db, `rooms/${Net.roomId}/trial`), { decisionText: decisionText });

            playSFX("gavel_strike");

            // Kích hoạt animation Búa Tòa Án nổ flash
            runGavelStrikeAnimation(decisionText, async () => {
                try {
                    const finalUpdates = {};

                    if (executeTarget) {
                        finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                        await Engine_Module.logMsg(`⚖️ Dân làng đã thi hành án treo cổ đối tượng [${accusedName}].`, "kill");

                        // XỬ LÝ ĐẶC BIỆT: Gã Hề (Clown) bị treo cổ -> Thắng Đơn Lập Lập Tức!
                        if (accusedPlayer && accusedPlayer.role === "clown") {
                            await StateMachine.triggerClownVictory(accusedPlayer);
                            isResolvingVote = false;
                            return;
                        }

                        // XỬ LÝ ĐẶC BIỆT: Thợ Săn (Hunter) bị treo cổ ban ngày -> Kích hoạt Modal nổ súng!
                        if (accusedPlayer && accusedPlayer.role === "hunter") {
                            await StateMachine.triggerHunterRevengeShot(accusedPlayer);
                        }

                    } else {
                        await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết tha bổng cho [${accusedName}].`, "sys");
                    }

                    // Dọn dẹp phiên tòa ban ngày
                    finalUpdates[`rooms/${Net.roomId}/trial`] = {
                        stage: "none",
                        accusedId: null,
                        accusedText: "",
                        decisionText: ""
                    };
                    finalUpdates[`rooms/${Net.roomId}/votes`] = null;
                    finalUpdates[`rooms/${Net.roomId}/nominations`] = null;

                    await update(ref(db), finalUpdates);
                    
                    await StateMachine.checkVictoryConditions();
                } catch (err) {
                    console.error("Lỗi sau biểu quyết:", err);
                } finally {
                    isResolvingVote = false;
                }
            });

        } catch (error) {
            console.error("Lỗi khi phán quyết bỏ phiếu:", error);
            isResolvingVote = false;
        }
    },

    // ==========================================
    // 7. SỰ KIỆN NỔ SÚNG TRẢ THÙ CỦA THỢ SĂN BAN NGÀY
    // ==========================================
    
    /**
     * Kích hoạt phát bắn trả thù của Thợ Săn khi bị hy sinh
     * @param {Object} hunterPlayer 
     */
    async triggerHunterRevengeShot(hunterPlayer) {
        const Net = window.Net;
        await Engine_Module.logMsg(`🏹 Thợ Săn [${hunterPlayer.name}] bị treo cổ! Kích hoạt phát bắn tiễn biệt...`, "kill");

        // Nếu người chơi hiện tại chính là Thợ Săn bị chết -> Mở Modal chọn mục tiêu
        if (Net.playerId === hunterPlayer.id) {
            const aliveOthers = Object.values(Net.players).filter(p => p.alive && p.id !== hunterPlayer.id);
            openHunterRevengeModal(aliveOthers, async (targetId) => {
                if (targetId) {
                    const victim = Net.players[targetId];
                    await update(ref(db, `rooms/${Net.roomId}/players/${targetId}`), { alive: false });
                    await Engine_Module.logMsg(`💥 Phát đạn cuối cùng của Thợ Săn [${hunterPlayer.name}] đã hạ sát [${victim?.name}]!`, "kill");
                    await StateMachine.checkVictoryConditions();
                }
            });
        }
    },

    // ==========================================
    // 8. KIỂM TRA ĐIỀU KIỆN CHIẾN THẮNG MỞ RỘNG
    // ==========================================
    
    /**
     * Kích hoạt chiến thắng Đơn Lập cho Gã Hề
     * @param {Object} clownPlayer 
     */
    async triggerClownVictory(clownPlayer) {
        const Net = window.Net;
        const mvpData = {
            name: clownPlayer.name,
            badge: "🤡 BẬC THẦY LỪA LỌC (CLOWN VICTORY)",
            stats: [
                { label: "Chiến thuật", value: "Dụ Làng Treo Cổ Thành Công" },
                { label: "Kết quả", value: "CHIẾN THẮNG ĐƠN LẬP" }
            ]
        };

        await update(ref(db, `rooms/${Net.roomId}/meta`), {
            phase: "victory",
            winner: "clown",
            mvp: mvpData,
            relations: []
        });

        playSFX("victory_fanfare");
        await Engine_Module.logMsg(`🤡 GÃ HỀ [${clownPlayer.name}] ĐÃ BỊ TREO CỔ! GÃ HỀ THẮNG ĐƠN LẬP!`, "info");
    },

    /**
     * Quét kiểm tra tất cả các điều kiện chiến thắng
     */
    async checkVictoryConditions() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players`));
            if (!snap.exists()) return;

            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            // 1. Kiểm tra Chiến thắng Cặp đôi Uyên Ương (Cupid Lovers)
            const coupleAlive = alivePlayers.filter(p => p.inCouple);
            if (alivePlayers.length === 2 && coupleAlive.length === 2) {
                if (coupleAlive[0].coupleId === coupleAlive[1].coupleId) {
                    const mvpData = {
                        name: `${coupleAlive[0].name} & ${coupleAlive[1].name}`,
                        badge: "💘 TÌNH YÊU BẤT DIỆT (COUPLE VICTORY)",
                        stats: [
                            { label: "Trạng thái", value: "Sống Sót Cùng Nhau Khác Phe" },
                            { label: "Thành tựu", value: "Vượt Qua Mọi Trắc Trở" }
                        ]
                    };

                    await update(ref(db, `rooms/${Net.roomId}/meta`), {
                        phase: "victory",
                        winner: "couple",
                        mvp: mvpData,
                        relations: [{ fromId: coupleAlive[0].id, toId: coupleAlive[1].id, type: "couple" }]
                    });

                    playSFX("victory_fanfare");
                    await Engine_Module.logMsg(`💘 CẶP ĐÔI UYÊN ƯƠNG [${coupleAlive[0].name}] & [${coupleAlive[1].name}] LÀ NHỮNG NGƯỜI SỐNG SÓT CUỐI CÙNG! UYÊN ƯƠNG CHIẾN THẮNG!`, "info");
                    return;
                }
            }

            // 2. Thống kê số lượng sinh mệnh từng phe
            const wolvesAlive = alivePlayers.filter(p => p.realFaction === "wolf").length;
            const villagersAlive = alivePlayers.filter(p => p.realFaction === "villager").length;
            const thirdsAlive = alivePlayers.filter(p => p.realFaction === "third").length;

            let winner = null;

            // Ma Sói thắng khi số lượng áp đảo hoặc bằng tổng các phe khác
            if (wolvesAlive >= villagersAlive + thirdsAlive && wolvesAlive > 0) {
                winner = "wolf";
            }
            // Dân Làng thắng khi tiêu diệt sạch Ma Sói và Phe Thứ Ba
            else if (wolvesAlive === 0 && thirdsAlive === 0) {
                winner = "villager";
            }
            // Phe Thứ Ba thắng khi dọn sạch 2 phe chính
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                const mvpCandidate = alivePlayers[0] || { name: "Thần dân", id: "none" };
                const mvpData = {
                    name: mvpCandidate.name,
                    badge: "Chiến Binh Sống Sót Anh Hùng",
                    stats: [
                        { label: "Trạng thái sinh mệnh", value: "CÒN SỐNG" },
                        { label: "Đóng góp phe", value: "Tối Cao" }
                    ]
                };

                const relationLogs = [];
                const couplePlayers = players.filter(p => p.inCouple);
                if (couplePlayers.length >= 2) {
                    relationLogs.push({
                        fromId: couplePlayers[0].id,
                        toId: couplePlayers[1].id,
                        type: "couple"
                    });
                }

                await update(ref(db, `rooms/${Net.roomId}/meta`), {
                    phase: "victory",
                    winner: winner,
                    mvp: mvpData,
                    relations: relationLogs
                });

                playSFX("victory_fanfare");
                await Engine_Module.logMsg(`🏆 TRẬN ĐẤU KẾT THÚC! PHE [${winner.toUpperCase()}] DÀNH CHIẾN THẮNG VINH QUANG!`, "info");
            }

        } catch (error) {
            console.error("Lỗi kiểm tra điều kiện chiến thắng:", error);
        }
    }
};