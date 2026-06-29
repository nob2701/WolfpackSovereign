import { Net, runGavelStrikeAnimation } from "./app.js";
import { db, ref, set, get, update } from "./firebase-config.js";
import { Engine_Module, ROLE_DB } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";

// Danh sách các vai trò hoàn toàn không có kỹ năng chủ động ban đêm (Passive Roles)
// Dùng để tự động gán turnEnded = true nhằm chống nghẽn pha đêm vô thời hạn
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

export const StateMachine = {
    // 1. CHUYỂN SANG PHA ĐÊM (NIGHT TRANSITION)
    async transitionToNight() {
        if (!Net.isHost) return;

        const roomRef = ref(db, `rooms/${Net.roomId}`);
        try {
            const snapshot = await get(roomRef);
            if (!snapshot.exists()) return;
            const roomData = snapshot.val();

            const nextDay = (roomData.meta.day || 0) + 1;
            
            // Khởi tạo trạng thái và dọn dẹp các luồng biểu quyết cũ trên máy chủ
            const updates = {
                "rooms/current_gavel_decision": null,
                [`rooms/${Net.roomId}/meta/phase`]: "night",
                [`rooms/${Net.roomId}/meta/day`]: nextDay,
                [`rooms/${Net.roomId}/votes`]: null,
                [`rooms/${Net.roomId}/nominations`]: null,
                [`rooms/${Net.roomId}/trial`]: {
                    stage: "none",
                    accusedId: null,
                    accusedText: ""
                }
            };

            // Thiết lập trạng thái hành động đêm cho từng người chơi sống
            Object.entries(roomData.players || {}).forEach(([playerId, player]) => {
                updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                
                if (!player.alive) {
                    // Người chết mặc định đã xong lượt
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                } else if (PASSIVE_NIGHT_ROLES.includes(player.role)) {
                    // SỬA LỖI 5: Tự động hoàn thành lượt cho vai trò không có kỹ năng đêm chủ động
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                } else {
                    // Các vai trò có kỹ năng đêm chủ động cần phải bấm nút để xong lượt
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false;
                }
            });

            await update(ref(db), updates);
            await Engine_Module.logMsg(`🌙 Bóng đêm bao phủ vương quốc Wolfpack. Đêm thứ ${nextDay} bắt đầu!`, "sys");
        } catch (error) {
            console.error("Gặp sự cố khi chuyển đổi sang pha đêm:", error);
        }
    },

    // 2. KIỂM TRA ĐỒNG BỘ TỰ ĐỘNG CHUYỂN NGÀY (AUTO-TRANSITION DAY CHECK)
    async checkAndAutoTransitionToDay() {
        if (!Net.isHost) return;

        const playersRef = ref(db, `rooms/${Net.roomId}/players`);
        try {
            const snap = await get(playersRef);
            if (!snap.exists()) return;
            
            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            // Kiểm tra xem tất cả người chơi còn sống đã hoàn thành lượt đêm nay chưa
            const allTurnsEnded = alivePlayers.every(p => p.turnEnded === true);

            if (allTurnsEnded) {
                await Engine_Module.logMsg("⚡ Toàn bộ thần dân có chức năng đã hoàn thành lượt hành động. Bình minh đang đến...", "sys");
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi khi quét trạng thái xong lượt của người chơi:", error);
        }
    },

    // 3. CƯỠNG CHẾ CHUYỂN NGÀY DÀNH CHO GM (FORCE DAY TRANSITION)
    // SỬA LỖI 5: Giúp Quản trò bỏ qua những người phản hồi chậm/AFK treo máy để tiếp tục trận đấu
    async forceTransitionToDay() {
        if (!Net.isHost) return;
        
        try {
            await Engine_Module.logMsg("⚠️ Quản trò đã cưỡng chế kết thúc đêm đen sớm để duy trì nhịp độ trận đấu!", "kill");
            await StateMachine.transitionToDay();
        } catch (error) {
            console.error("Lỗi khi cưỡng chế chuyển ngày:", error);
        }
    },

    // 4. CHUYỂN SANG PHA NGÀY (DAY TRANSITION)
    async transitionToDay() {
        if (!Net.isHost) return;

        try {
            // Giải quyết xung đột ưu tiên bằng Tick Engine
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);

            const updates = {};
            updates[`rooms/${Net.roomId}/meta/phase`] = "day";

            // Ghi nhận trạng thái tử vong từ kết quả của đêm
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Phân phối mật thư từ kết quả đêm vào Mailbox cá nhân của từng người chơi
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

            // Đồng bộ toàn bộ trạng thái mới lên server Firebase
            await update(ref(db), updates);

            // Ghi nhật ký công khai cho dân làng nắm bắt thông tin sinh mệnh
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh rạng rỡ! Một đêm yên bình trôi qua, không có ai bị hạ sát trong bóng tối.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => Net.players[id]?.name || "Ẩn danh").join(", ");
                announcement = `☀️ Bình minh rạng rỡ! Đêm qua vương quốc ghi nhận ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");

            // Kiểm tra điều kiện thắng trận
            await StateMachine.checkVictoryConditions();

        } catch (error) {
            console.error("Lỗi tiến trình phân giải đêm đen:", error);
        }
    },

    // 5. PHÂN GIẢI PHÁN QUYẾT BỎ PHIẾU TREO CỔ (VOTING RESOLUTION)
    async resolveVotingOutcome() {
        if (!Net.isHost) return;

        const roomRef = ref(db, `rooms/${Net.roomId}`);
        try {
            const snapshot = await get(roomRef);
            if (!snapshot.exists()) return;
            const roomData = snapshot.val();
            const trial = roomData.trial || { accusedId: null };
            const votes = roomData.votes || {};

            if (!trial.accusedId) return;

            let countAcquit = 0;
            let countExecute = 0;

            Object.values(votes).forEach(voteValue => {
                if (voteValue === "ACQUIT") countAcquit++;
                if (voteValue === "EXECUTE") countExecute++;
            });

            const accusedName = roomData.players[trial.accusedId]?.name || "Bị cáo";
            let decisionText = "";
            let executeTarget = false;

            if (countExecute > countAcquit) {
                decisionText = `BẢN ÁN TỬ HÌNH DÀNH CHO: ${accusedName.toUpperCase()}!`;
                executeTarget = true;
            } else {
                decisionText = `${accusedName.toUpperCase()} ĐÃ ĐƯỢC THA BỔNG THÀNH CÔNG!`;
            }

            // Đồng bộ hóa quyết định biểu quyết lên Server để kích hoạt hiệu ứng hình ảnh
            await update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "verdict",
                decisionText: decisionText
            });

            // Kích hoạt hoạt ảnh búa gõ phán quyết
            runGavelStrikeAnimation(decisionText, async () => {
                const finalUpdates = {};
                if (executeTarget) {
                    finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                    await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết thi hành án treo cổ đối tượng [${accusedName}].`, "kill");
                } else {
                    await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết tha bổng hoàn toàn cho [${accusedName}].`, "sys");
                }

                // Dọn dẹp trạng thái để trở về luồng thảo luận tự do hoặc chuyển đêm mới
                finalUpdates[`rooms/${Net.roomId}/trial`] = {
                    stage: "none",
                    accusedId: null,
                    accusedText: ""
                };
                finalUpdates[`rooms/${Net.roomId}/votes`] = null;
                finalUpdates[`rooms/${Net.roomId}/nominations`] = null;

                await update(ref(db), finalUpdates);
                
                // Kiểm tra điều kiện thắng sau phán quyết treo cổ
                await StateMachine.checkVictoryConditions();
            });

        } catch (error) {
            console.error("Gặp sự cố khi phân giải phiếu biểu quyết:", error);
        }
    },

    // 6. KIỂM TRA ĐIỀU KIỆN THẮNG TRẬN (VICTORY CHECK CONDITIONS)
    async checkVictoryConditions() {
        if (!Net.isHost) return;

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

            // Kịch bản 1: Phe Sói quét sạch lực lượng Dân Làng và Phe Thứ Ba
            if (wolvesAlive >= villagersAlive + thirdsAlive) {
                winner = "wolf";
            }
            // Kịch bản 2: Ma Sói bị tiêu diệt sạch sẽ
            else if (wolvesAlive === 0 && thirdsAlive === 0) {
                winner = "villager";
            }
            // Kịch bản 3: Phe Thứ Ba áp đảo hoặc cô lập hoàn toàn các phe phái chính
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                // Khởi tạo gói dữ liệu thống kê tổng kết MVP
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
                // Quét thông tin tình trường Cupid để vẽ bản đồ quan hệ
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

// Lắng nghe đồng bộ kết quả biểu quyết từ máy Host để vẽ búa tòa án cho máy Client
export function syncRealtimeTrialStages(roomData) {
    const trial = roomData.trial || { stage: "none", decisionText: "" };
    if (trial.stage === "verdict" && trial.decisionText) {
        runGavelStrikeAnimation(trial.decisionText);
    }
}