import { db, ref, get, update, runTransaction } from "./firebase-config.js";
import { Engine_Module } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";
import { runGavelStrikeAnimation, showToast } from "./ui-manager.js";

// Khóa trạng thái cục bộ (Mutex) dùng cho UI (Chống spam click)
let isLocalTransitioning = false;
let isResolvingVote = false;

// Danh sách vai trò thụ động ban đêm (Không có nút kích hoạt kỹ năng, tự động End Turn)
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

// Danh sách các trạng thái (Buff/Debuff thị giác) CẦN ĐƯỢC XÓA khi qua đêm mới (Sửa Bug 5)
const TRANSIENT_STATES = [
    "isSeerScanned", "isProtected", "isWitchHealed", "isWitchPoisoned",
    "isHunterMarked", "isAngelPurified", "isReflectorMirrored",
    "isWolfTargeted", "isWolfMageScanned", "isDemonHellfire", "isPhantomSwapped"
    // Ghi chú: isPetroled (Tẩm xăng), inCouple (Ghép đôi), isVampireBitten không bị xóa vì có tác dụng dài hạn
];

export const StateMachine = {
    // ==========================================
    // 1. CHUYỂN SANG PHA ĐÊM (NIGHT TRANSITION)
    // ==========================================
    async transitionToNight() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isLocalTransitioning) return;

        isLocalTransitioning = true;
        const roomRef = ref(db, `rooms/${Net.roomId}`);
        
        try {
            const snapshot = await get(roomRef);
            if (!snapshot.exists()) return;
            const roomData = snapshot.val();

            if (roomData.meta.phase === "night") return;

            const nextDay = (roomData.meta.day || 0) + 1;
            const updates = {
                [`rooms/${Net.roomId}/meta/phase`]: "night",
                [`rooms/${Net.roomId}/meta/day`]: nextDay,
                [`rooms/${Net.roomId}/votes`]: null,
                [`rooms/${Net.roomId}/nominations`]: null,
                [`rooms/${Net.roomId}/trial`]: {
                    stage: "none",
                    accusedId: null,
                    accusedText: "",
                    decisionText: ""
                }
            };

            // Thiết lập trạng thái hành động đêm & Xóa hiệu ứng cũ (Sửa Bug 5)
            Object.entries(roomData.players || {}).forEach(([playerId, player]) => {
                updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                
                // Xóa các buff/debuff hình ảnh của đêm/ngày trước đó
                TRANSIENT_STATES.forEach(state => {
                    if (player[state]) {
                        updates[`rooms/${Net.roomId}/players/${playerId}/${state}`] = null;
                    }
                });
                
                // Mở khóa câm lặng khi qua đêm mới
                if (player.isSilencerMuted) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/isSilencerMuted`] = null;
                }

                if (!player.alive) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                } else if (PASSIVE_NIGHT_ROLES.includes(player.role)) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                } else {
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false;
                }
            });

            await update(ref(db), updates);
            await Engine_Module.logMsg(`🌙 Bóng đêm bao phủ vương quốc. Đêm thứ ${nextDay} bắt đầu!`, "sys");
        } catch (error) {
            console.error("Gặp sự cố khi chuyển đổi sang pha đêm:", error);
            showToast("Không thể đồng bộ pha đêm sang máy chủ!", "danger");
        } finally {
            isLocalTransitioning = false;
        }
    },

    // ==========================================
    // 2. TỰ ĐỘNG CHUYỂN NGÀY KHI MỌI NGƯỜI XONG LƯỢT
    // ==========================================
    async checkAndAutoTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        const playersRef = ref(db, `rooms/${Net.roomId}/players`);
        try {
            const snap = await get(playersRef);
            if (!snap.exists()) return;
            
            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            // Kiểm tra xem tất cả người sống đã hoàn thành lượt chưa
            const allTurnsEnded = alivePlayers.every(p => p.turnEnded === true);

            if (allTurnsEnded) {
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi khi quét trạng thái xong lượt của người chơi:", error);
        }
    },

    // ==========================================
    // 3. GM CƯỠNG CHẾ CHUYỂN NGÀY (FORCE DAY)
    // ==========================================
    async forceTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        
        try {
            await Engine_Module.logMsg("⚠️ Quản trò đã cưỡng chế kết thúc đêm đen sớm để duy trì nhịp độ trận đấu!", "kill");
            await StateMachine.transitionToDay();
        } catch (error) {
            console.error("Lỗi khi cưỡng chế chuyển ngày:", error);
        }
    },

    // ==========================================
    // 4. CHUYỂN NGÀY VÀ PHÂN GIẢI LOGIC ĐÊM (SỬA BUG 13: GẮN TRANSACTION LOCK)
    // ==========================================
    async transitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        
        const phaseRef = ref(db, `rooms/${Net.roomId}/meta/phase`);

        try {
            // SỬA BUG 13: Khóa Transaction. Đảm bảo chỉ 1 client được quyền chạy logic phân giải.
            const transactionResult = await runTransaction(phaseRef, (currentPhase) => {
                if (currentPhase === "night") {
                    return "processing_day"; // Khóa lại, các luồng khác thấy chữ này sẽ bị abort
                }
                return; // Trả về undefined sẽ Hủy Transaction
            });

            if (!transactionResult.committed) {
                console.warn("Tiến trình chuyển ngày đã được xử lý bởi một luồng khác. Hủy bỏ luồng trùng lặp.");
                return; 
            }

            // --- BẮT ĐẦU VÙNG AN TOÀN (CHỈ 1 MÁY CHỦ CHẠY) ---
            isLocalTransitioning = true;
            
            // Phân giải logic từ TickEngine
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);

            const updates = {};
            updates[`rooms/${Net.roomId}/meta/phase`] = "day";

            // Sát thương hạ sát
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Ghi nhận trạng thái bùa chú mới
            for (const [playerId, fields] of Object.entries(resolutionOutcome.playerStateUpdates)) {
                for (const [fieldKey, val] of Object.entries(fields)) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/${fieldKey}`] = val;
                }
            }

            // Phát thư vào Mailbox
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

            // Ghi toàn bộ dữ liệu lên Firebase
            await update(ref(db), updates);

            // Ghi lịch sử
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh rạng rỡ! Một đêm yên bình trôi qua, không có ai bị hạ sát trong bóng tối.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => window.G.players.find(p => p.id === id)?.name || "Ẩn danh").join(", ");
                announcement = `☀️ Bình minh rạng rỡ! Đêm qua vương quốc ghi nhận ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");
            await StateMachine.checkVictoryConditions();

        } catch (error) {
            console.error("Lỗi tiến trình phân giải đêm đen:", error);
            showToast("Có lỗi xảy ra khi tính toán kết quả đêm!", "danger");
            // Mở khóa phòng trường hợp lỗi
            await update(ref(db, `rooms/${Net.roomId}/meta`), { phase: "day" });
        } finally {
            isLocalTransitioning = false;
        }
    },

    // ==========================================
    // 5. PHÂN GIẢI PHIẾU TREO CỔ (SỬA LỖI BUG 2 & SOFTLOCK)
    // ==========================================
    async resolveVotingOutcome() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isResolvingVote) return;

        isResolvingVote = true;

        const roomRef = ref(db, `rooms/${Net.roomId}`);
        try {
            const snapshot = await get(roomRef);
            if (!snapshot.exists()) {
                isResolvingVote = false;
                return;
            }
            const roomData = snapshot.val();
            const trial = roomData.trial || { accusedId: null };
            const votes = roomData.votes || {};

            if (!trial.accusedId) {
                isResolvingVote = false;
                return;
            }

            let countAcquit = 0;
            let countExecute = 0;

            // Kiểm tra chặt chẽ, loại bỏ những phiếu rác nếu có
            Object.values(votes).forEach(voteValue => {
                if (voteValue === "ACQUIT") countAcquit++;
                if (voteValue === "EXECUTE") countExecute++;
            });

            const accusedName = roomData.players[trial.accusedId]?.name || "Bị cáo";
            let decisionText = "";
            let executeTarget = false;

            // Xử lý Logic phán quyết (Nếu hòa hoặc phiếu Tha bổng thắng -> Tha bổng)
            if (countExecute > countAcquit) {
                decisionText = `BẢN ÁN TỬ HÌNH DÀNH CHO: ${accusedName.toUpperCase()}!`;
                executeTarget = true;
            } else {
                decisionText = `${accusedName.toUpperCase()} ĐÃ ĐƯỢC THA BỔNG THÀNH CÔNG!`;
            }

            // Ghi nhận Text lên Firebase để UI của tất cả người chơi kích hoạt Hoạt ảnh Búa
            await update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "verdict",
                decisionText: decisionText
            });

            // Kích hoạt Hoạt ảnh trên máy Quản trò, sau đó thực thi án tử trên Database
            runGavelStrikeAnimation(decisionText, async () => {
                try {
                    const finalUpdates = {};
                    if (executeTarget) {
                        finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                        await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết thi hành án treo cổ đối tượng [${accusedName}].`, "kill");
                    } else {
                        await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết tha bổng hoàn toàn cho [${accusedName}].`, "sys");
                    }

                    // Reset và dọn dẹp hệ thống Bỏ phiếu
                    finalUpdates[`rooms/${Net.roomId}/trial`] = {
                        stage: "none",
                        accusedId: null,
                        accusedText: "",
                        decisionText: ""
                    };
                    finalUpdates[`rooms/${Net.roomId}/votes`] = null;
                    finalUpdates[`rooms/${Net.roomId}/nominations`] = null;

                    await update(ref(db), finalUpdates);
                    
                    // Kiểm tra thắng thua sau khi treo cổ
                    await StateMachine.checkVictoryConditions();
                } catch (err) {
                    console.error("Lỗi cập nhật dữ liệu sau biểu quyết:", err);
                } finally {
                    isResolvingVote = false;
                }
            });

        } catch (error) {
            console.error("Gặp sự cố khi phân giải phiếu biểu quyết:", error);
            isResolvingVote = false;
        }
    },

    // ==========================================
    // 6. KIỂM TRA ĐIỀU KIỆN THẮNG (VICTORY CHECK)
    // ==========================================
    async checkVictoryConditions() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        const playersRef = ref(db, `rooms/${Net.roomId}/players`);
        try {
            const snap = await get(playersRef);
            if (!snap.exists()) return;
            const players = Object.values(snap.val() || {});

            const alivePlayers = players.filter(p => p.alive);
            const wolvesAlive = alivePlayers.filter(p => p.realFaction === "wolf").length;
            const villagersAlive = alivePlayers.filter(p => p.realFaction === "villager").length;
            const thirdsAlive = alivePlayers.filter(p => p.realFaction === "third").length;

            let winner = null;

            // Kịch bản 1: Sói chiếm tỷ lệ bàng nhau hoặc lớn hơn Làng + Phe 3 cộng lại
            if (wolvesAlive >= villagersAlive + thirdsAlive && wolvesAlive > 0) {
                winner = "wolf";
            }
            // Kịch bản 2: Toàn bộ phe tà ác bị tiêu diệt
            else if (wolvesAlive === 0 && thirdsAlive === 0 && villagersAlive > 0) {
                winner = "villager";
            }
            // Kịch bản 3: Phe Thứ Ba cướp cờ (Sói chết hết, Dân làng chết hết)
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                // Lấy tạm 1 người sống sót làm MVP (Sau này có thể nâng cấp hệ thống tính điểm)
                const mvpCandidate = alivePlayers[0] || { name: "Kẻ vô danh", id: "none" };
                const mvpData = {
                    name: mvpCandidate.name,
                    badge: "Người sống sót cuối cùng",
                    stats: [
                        { label: "Trạng thái sinh mệnh", value: "CÒN SỐNG" },
                        { label: "Mức độ cống hiến", value: "Tối Cao" }
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

                await Engine_Module.logMsg(`🏆 TRẬN ĐẤU KẾT THÚC! Phe [${winner.toUpperCase()}] dành chiến thắng vinh quang!`, "info");
            }

        } catch (error) {
            console.error("Lỗi kiểm tra điều kiện chiến thắng ván đấu:", error);
        }
    }
};