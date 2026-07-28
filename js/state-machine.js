import { db, ref, get, set, update, runTransaction } from "./firebase-config.js";
import { Engine_Module, getRoleName } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";
import { runGavelStrikeAnimation, showToast, playSFX, playBGM } from "./ui-manager.js";

// Khóa trạng thái cục bộ bảo vệ luồng bất đồng bộ trên Client
let isTransitioning = false;
let isResolvingVote = false;
let localTimerInterval = null;

// Danh sách vai trò thụ động ban đêm (không cần thao tác chọn mục tiêu)
const PASSIVE_NIGHT_ROLES = [
    "villager", 
    "clown", 
    "idiot", 
    "ghost", 
    "halfWolf", 
    "apprenticeSeer", 
    "doppelganger", 
    "lostChild"
];

// Thời lượng đếm ngược mặc định cho từng pha (giây)
const PHASE_DURATIONS = {
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
    startPhaseTimer(durationSeconds) {
        const Net = window.Net;
        if (!Net || !Net.roomId) return;

        const endTime = Date.now() + (durationSeconds * 1000);
        update(ref(db, `rooms/${Net.roomId}/meta`), {
            timerEndTime: endTime,
            timerDuration: durationSeconds
        });
    },

    syncPhaseTimer(endTime, duration) {
        if (localTimerInterval) clearInterval(localTimerInterval);

        const container = document.getElementById("phase-timer-container");
        const display = document.getElementById("phase-timer-display");
        const bar = document.getElementById("phase-timer-bar");

        if (!container || !display || !bar || !endTime) {
            container?.classList.add("hidden");
            return;
        }

        container.classList.remove("hidden");

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
            } else {
                display.style.color = "var(--accent)";
                bar.style.background = "var(--accent)";
            }

            // Tự động kích hoạt chuyển pha khi hết thời gian (Dành cho Quản trò)
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
                // Hết giờ biện hộ -> Chuyển sang bỏ phiếu
                await update(ref(db, `rooms/${Net.roomId}/trial`), { stage: "vote" });
                StateMachine.startPhaseTimer(PHASE_DURATIONS.vote);
            } else if (trialStage === "vote") {
                await StateMachine.resolveVotingOutcome();
            }
        }
    },

    // ==========================================
    // 2. BẦU CHỌN VÀ CHUYỂN GIAO TRƯỞNG LÀNG
    // ==========================================
    async startMayorElection() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            await update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "mayor_election",
                accusedId: null
            });
            await update(ref(db, `rooms/${Net.roomId}/mayor_votes`), null);
            
            StateMachine.startPhaseTimer(PHASE_DURATIONS.mayor_election);
            await Engine_Module.logMsg("👑 Cuộc trưng cầu dân ý bầu chọn Trưởng Làng chính thức bắt đầu!", "info");
        } catch (err) {
            console.error("Lỗi khởi tạo bầu Trưởng Làng:", err);
        }
    },

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
            await Engine_Module.logMsg("👑 Cuộc bầu chọn thất bại do không có ứng viên đạt đủ phiếu. Vương quốc tạm thời vắng Trưởng Làng!", "sys");
        }

        // Đặt lại đếm ngược ban ngày
        StateMachine.startPhaseTimer(PHASE_DURATIONS.day_discussion);
    },

    async passMayorTitle(newMayorId) {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players/${newMayorId}`));
            if (snap.exists()) {
                await update(ref(db, `rooms/${Net.roomId}/meta`), { mayorId: newMayorId });
                await Engine_Module.logMsg(`👑 Chức vị Trưởng Làng đã được di ngôn kế thừa cho [${snap.val().name}]!`, "info");
            }
        } catch (err) {
            console.error("Lỗi chuyển giao chức Trưởng Làng:", err);
        }
    },

    // ==========================================
    // 3. CHUYỂN SANG PHA ĐÊM (NIGHT TRANSITION)
    // ==========================================
    async transitionToNight() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        isTransitioning = true;
        
        try {
            let success = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/meta`), (meta) => {
                if (!meta) return meta;
                if (meta.phase === "night") return; // Bỏ qua nếu đã là đêm
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

            const snap = await get(ref(db, `rooms/${Net.roomId}/players`));
            if (snap.exists()) {
                const players = snap.val();
                const updates = {};
                
                // Dọn dẹp dữ liệu bỏ phiếu cũ
                updates[`rooms/${Net.roomId}/votes`] = null;
                updates[`rooms/${Net.roomId}/nominations`] = null;
                updates[`rooms/${Net.roomId}/trial`] = {
                    stage: "none",
                    accusedId: null,
                    accusedText: "",
                    decisionText: ""
                };

                // Đặt lại lượt cho người chơi
                Object.entries(players).forEach(([playerId, player]) => {
                    updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                    
                    if (!player.alive || PASSIVE_NIGHT_ROLES.includes(player.role)) {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                    } else {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false;
                    }
                });

                await update(ref(db), updates);

                const currentDaySnap = await get(ref(db, `rooms/${Net.roomId}/meta/day`));
                const nextDay = currentDaySnap.val() || 1;
                await Engine_Module.logMsg(`🌙 Bóng đêm bao phủ vương quốc. Đêm thứ ${nextDay} bắt đầu!`, "sys");

                StateMachine.startPhaseTimer(PHASE_DURATIONS.night);
            }
        } catch (error) {
            console.error("Lỗi khi chuyển pha đêm:", error);
            showToast("Không thể đồng bộ pha đêm sang máy chủ!", "danger");
        } finally {
            isTransitioning = false;
        }
    },

    // ==========================================
    // 4. KIỂM TRA ĐỒNG BỘ TỰ ĐỘNG CHUYỂN NGÀY
    // ==========================================
    async checkAndAutoTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players`));
            if (!snap.exists()) return;
            
            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            const allTurnsEnded = alivePlayers.every(p => p.turnEnded === true);

            if (allTurnsEnded) {
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi quét lượt người chơi:", error);
        }
    },

    async forceTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;
        
        try {
            await Engine_Module.logMsg("⚠️ Quản trò đã cưỡng chế kết thúc đêm đen sớm!", "kill");
            await StateMachine.transitionToDay();
        } catch (error) {
            console.error("Lỗi cưỡng chế chuyển ngày:", error);
        }
    },

    // ==========================================
    // 5. CHUYỂN SANG PHA NGÀY VÀ PHÂN GIẢI KỸ NĂNG ĐÊM
    // ==========================================
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

            // Phân giải toàn bộ hành động đêm qua TickEngine
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);
            const updates = {};

            // Cập nhật tử vong
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Cập nhật bùa chú/trạng thái mới
            for (const [playerId, fields] of Object.entries(resolutionOutcome.playerStateUpdates)) {
                for (const [fieldKey, val] of Object.entries(fields)) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/${fieldKey}`] = val;
                }
            }

            // Gửi mật thư vào Mailbox
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

            // Công bố danh sách tử vong
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh rạng rỡ! Một đêm yên bình trôi qua, không có ai bị hại.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => Net.players[id]?.name || "Ẩn danh").join(", ");
                announcement = `☀️ Bình minh rạng rỡ! Đêm qua vương quốc ghi nhận ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");

            // Bầu Trưởng Làng vào Ngày 1 nếu chưa có
            const currentMetaSnap = await get(ref(db, `rooms/${Net.roomId}/meta`));
            const metaData = currentMetaSnap.val() || {};

            if (metaData.day === 1 && !metaData.mayorId) {
                await StateMachine.startMayorElection();
            } else {
                StateMachine.startPhaseTimer(PHASE_DURATIONS.day_discussion);
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

            // Tính điểm phiếu bầu (Phiếu của Trưởng Làng tính trọng số 2)
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
            } else if (countAcquit > countExecute) {
                decisionText = `${accusedName.toUpperCase()} ĐÃ ĐƯỢC THA BỔNG THÀNH CÔNG!`;
            } else {
                // Hòa phiếu -> Trưởng Làng quyết định nếu có, ngược lại Tha bổng
                decisionText = `HÒA PHIẾU! BẢN ÁN DÀNH CHO ${accusedName.toUpperCase()} LÀ THA BỔNG.`;
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

            // Kích hoạt animation Búa Tòa Án
            runGavelStrikeAnimation(decisionText, async () => {
                try {
                    const finalUpdates = {};

                    if (executeTarget) {
                        finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                        await Engine_Module.logMsg(`⚖️ Dân làng đã thi hành án treo cổ đối tượng [${accusedName}].`, "kill");

                        // ĐẶC THÙ VAI TRÒ: Gã Hề (Clown) bị treo cổ -> Thắng lập tức
                        if (accusedPlayer && accusedPlayer.role === "clown") {
                            await StateMachine.triggerClownVictory(accusedPlayer);
                            isResolvingVote = false;
                            return;
                        }

                        // ĐẶC THÙ VAI TRÒ: Thợ Săn (Hunter) bị treo cổ -> Cho phép bắn hạ trước khi chết
                        if (accusedPlayer && accusedPlayer.role === "hunter") {
                            await Engine_Module.logMsg(`🏹 Thợ Săn [${accusedName}] bị treo cổ! Kích hoạt phát bắn trả thù...`, "kill");
                        }

                    } else {
                        await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết tha bổng hoàn toàn cho [${accusedName}].`, "sys");
                    }

                    // Dọn dẹp phiên tòa
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
    // 7. KIỂM TRA ĐIỀU KIỆN CHIẾN THẮNG MỞ RỘNG (WIN CONDITIONS)
    // ==========================================
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

    async checkVictoryConditions() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players`));
            if (!snap.exists()) return;

            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            // 1. Kiểm tra Chiến thắng Cặp đôi Uyên Ương (Cupid Lovers Win)
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

            // Ma Sói thắng khi số lượng áp đảo
            if (wolvesAlive >= villagersAlive + thirdsAlive && wolvesAlive > 0) {
                winner = "wolf";
            }
            // Dân Làng thắng khi Ma Sói và Phe Thứ Ba sạch bóng
            else if (wolvesAlive === 0 && thirdsAlive === 0) {
                winner = "villager";
            }
            // Phe Thứ Ba thắng khi dọn sạch 2 phe chính
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                const mvpCandidate = alivePlayers[0] || { name: "Ẩn danh", id: "none" };
                const mvpData = {
                    name: mvpCandidate.name,
                    badge: "Người sống sót anh hùng",
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
                await Engine_Module.logMsg(`🏆 TRẬN ĐẤU KẾT THÚC! Phe [${winner.toUpperCase()}] DÀNH CHIẾN THẮNG VINH QUANG!`, "info");
            }

        } catch (error) {
            console.error("Lỗi kiểm tra điều kiện chiến thắng:", error);
        }
    }
};