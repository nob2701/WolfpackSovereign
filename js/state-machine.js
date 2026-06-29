import { Net, runGavelStrikeAnimation } from "./app.js";
import { db, ref, set, get, update, onValue } from "./firebase-config.js";
import { Engine_Module, UI_Module } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";

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
            
            // Khởi tạo và xóa sạch dữ liệu tạm của pha cũ trên server
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

            // Thiết lập lại trạng thái chọn mục tiêu và kết thúc lượt của mọi người chơi cho đêm mới
            Object.keys(roomData.players || {}).forEach(playerId => {
                updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false; // Thiết lập lại nút xác nhận lượt
            });

            await update(ref(db), updates);
            await Engine_Module.logMsg(`🌙 Bóng đêm bao phủ vương quốc Wolfpack. Đêm thứ ${nextDay} bắt đầu!`, "sys");
        } catch (error) {
            console.error("Lỗi khi chuyển sang pha đêm:", error);
        }
    },

    // 2. TỰ ĐỘNG KIỂM TRA VÀ CHUYỂN NGÀY KHI TẤT CẢ KẾT THÚC LƯỢT
    async checkAndAutoTransitionToDay() {
        if (!Net.isHost) return;

        const playersRef = ref(db, `rooms/${Net.roomId}/players`);
        try {
            const snap = await get(playersRef);
            if (!snap.exists()) return;
            
            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            // Kiểm tra xem tất cả người chơi còn sống đã nhấn "Xác nhận kết thúc lượt" hay chưa
            const allTurnsEnded = alivePlayers.every(p => p.turnEnded === true);

            if (allTurnsEnded) {
                await Engine_Module.logMsg("⚡ Tất cả thần dân và thế lực bóng đêm đã hoàn thành lượt. Bình minh đang hé rạng...", "sys");
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi kiểm tra trạng thái kết thúc lượt của người chơi:", error);
        }
    },

    // 3. CHUYỂN SANG PHA NGÀY (DAY TRANSITION)
    // Tự động giải quyết xung đột chức năng đêm thông qua TickEngine trước khi mặt trời mọc
    async transitionToDay() {
        if (!Net.isHost) return;

        try {
            // 3.1 Chạy công cụ phân giải độ ưu tiên hành động đêm (Tick Engine)
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);

            // 3.2 Đóng gói cập nhật trạng thái sống/chết và gửi thông điệp mật vào Mailbox
            const updates = {};
            updates[`rooms/${Net.roomId}/meta/phase`] = "day";

            // Áp dụng trạng thái tử vong lên người chơi bị hạ sát
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Gửi mật thư chức năng và kết quả vào mailbox cá nhân
            for (const [playerId, mails] of Object.entries(resolutionOutcome.mailboxDeliveries)) {
                for (const mail of mails) {
                    const mailId = "mail_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
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

            // Đồng bộ dữ liệu lên Firebase
            await update(ref(db), updates);

            // Ghi nhật ký sự kiện công khai cho làng
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh lên! Một đêm bình yên trôi qua, không có ai bị hạ sát.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => Net.players[id]?.name || "Ẩn danh").join(", ");
                announcement = `☀️ Bình minh lên! Đêm qua có ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");

            // Kiểm tra điều kiện kết thúc game ngay lập tức
            await StateMachine.checkVictoryConditions();

        } catch (error) {
            console.error("Gặp sự cố khi giải quyết dữ liệu đêm:", error);
        }
    },

    // 4. XỬ LÝ PHÁN QUYẾT BỎ PHIẾU TREO CỔ (VOTING RESOLUTION)
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
                decisionText = `${accusedName.toUpperCase()} ĐÃ ĐƯỢC LÀNG THA BỔNG!`;
            }

            // Gửi quyết định biểu quyết lên Server để kích hoạt animation đồng bộ trên toàn bộ máy khách
            await update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "verdict",
                decisionText: decisionText
            });

            // Gọi hoạt ảnh búa tòa án đập trên Quản trò
            runGavelStrikeAnimation(decisionText, async () => {
                const finalUpdates = {};
                if (executeTarget) {
                    finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                    await Engine_Module.logMsg(`⚖️ Dân làng đã bỏ phiếu treo cổ [${accusedName}] thành công.`, "kill");
                } else {
                    await Engine_Module.logMsg(`⚖️ Dân làng phán quyết tha bổng cho bị cáo [${accusedName}].`, "sys");
                }

                // Chuyển về chế độ thảo luận tự do hoặc chuẩn bị đêm mới
                finalUpdates[`rooms/${Net.roomId}/trial`] = {
                    stage: "none",
                    accusedId: null,
                    accusedText: ""
                };
                finalUpdates[`rooms/${Net.roomId}/votes`] = null;
                finalUpdates[`rooms/${Net.roomId}/nominations`] = null;

                await update(ref(db), finalUpdates);
                
                // Kiểm tra điều kiện thắng sau khi treo cổ
                await StateMachine.checkVictoryConditions();
            });

        } catch (error) {
            console.error("Lỗi khi xử lý phán quyết biểu quyết:", error);
        }
    },

    // 5. KIỂM TRA ĐIỀU KIỆN THẮNG CUỘC (VICTORY CHECK)
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

            // Kịch bản 1: Phe Sói quét sạch dân làng
            if (wolvesAlive >= villagersAlive + thirdsAlive) {
                winner = "wolf";
            }
            // Kịch bản 2: Sói bị tiêu diệt hoàn toàn
            else if (wolvesAlive === 0 && thirdsAlive === 0) {
                winner = "villager";
            }
            // Kịch bản 3: Phe thứ 3 áp đảo hoặc đạt điều kiện thắng đặc biệt
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                // Khởi tạo thông tin MVP phục vụ trình diễn tổng kết
                const mvpData = {
                    name: alivePlayers[0]?.name || "Kẻ Vô Danh",
                    badge: "Người Sống Sót Cuối Cùng",
                    stats: [
                        { label: "Mức độ cống hiến", value: "100%" },
                        { label: "Lá phiếu chính xác", value: "3/3" }
                    ]
                };

                const relationLogs = [
                    { fromId: alivePlayers[0]?.id || "", toId: alivePlayers[1]?.id || "", type: "couple" }
                ];

                await update(ref(db, `rooms/${Net.roomId}/meta`), {
                    phase: "victory",
                    winner: winner,
                    mvp: mvpData,
                    relations: relationLogs
                });

                await Engine_Module.logMsg(`🏆 TRẬN ĐẤU KẾT THÚC! Phe [${winner.toUpperCase()}] dành chiến thắng tối cao!`, "info");
            }

        } catch (error) {
            console.error("Lỗi khi kiểm tra điều kiện thắng:", error);
        }
    }
};

// Đồng bộ trạng thái game trực tuyến từ Quản trò xuống toàn bộ Clients
export function syncRealtimeTrialStages(roomData) {
    const trial = roomData.trial || { stage: "none", decisionText: "" };
    if (trial.stage === "verdict" && trial.decisionText) {
        runGavelStrikeAnimation(trial.decisionText);
    }
}