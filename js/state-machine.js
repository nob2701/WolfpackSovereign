import { db, ref, get, update } from "./firebase-config.js";
import { Engine_Module, ROLE_DB } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";
import { runGavelStrikeAnimation, showToast } from "./ui-manager.js";

// Khóa trạng thái (Mutex Lock) chống lặp phân giải biểu quyết dồn dập khi nhận sự kiện onValue liên tục
let isResolvingVote = false;

// Danh sách vai trò thụ động ban đêm đồng bộ với thiết lập hệ thống
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
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        const roomRef = ref(db, `rooms/${Net.roomId}`);
        try {
            const snapshot = await get(roomRef);
            if (!snapshot.exists()) return;
            const roomData = snapshot.val();

            const nextDay = (roomData.meta.day || 0) + 1;
            
            // Khởi tạo trạng thái đêm mới và dọn dẹp dữ liệu biểu quyết cũ trên Firebase
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

            // Thiết lập trạng thái hành động đêm cho từng người chơi
            Object.entries(roomData.players || {}).forEach(([playerId, player]) => {
                updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                
                if (!player.alive) {
                    // Người chết mặc định đã hoàn thành lượt hành động
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                } else if (PASSIVE_NIGHT_ROLES.includes(player.role)) {
                    // Vai trò thụ động không có kỹ năng chủ động ban đêm -> Mặc định xong lượt
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                } else {
                    // Vai trò chủ động bắt đầu pha đêm với trạng thái chưa hoàn thành
                    updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false;
                }
            });

            await update(ref(db), updates);
            await Engine_Module.logMsg(`🌙 Bóng đêm bao phủ vương quốc. Đêm thứ ${nextDay} bắt đầu!`, "sys");
        } catch (error) {
            console.error("Gặp sự cố khi chuyển đổi sang pha đêm:", error);
            showToast("Không thể đồng bộ pha đêm sang máy chủ!", "danger");
        }
    },

    // 2. KIỂM TRA ĐỒNG BỘ TỰ ĐỘNG CHUYỂN NGÀY (AUTO-TRANSITION DAY CHECK)
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
                await Engine_Module.logMsg("⚡ Toàn bộ thần dân có chức năng chủ động đã hoàn thành lượt hành động. Bình minh đang đến...", "sys");
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi khi quét trạng thái xong lượt của người chơi:", error);
        }
    },

    // 3. CƯỠNG CHẾ CHUYỂN NGÀY CỦA QUẢN TRÒ (FORCE DAY TRANSITION)
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

    // 4. CHUYỂN SANG PHA NGÀY (DAY TRANSITION - PHÂN GIẢI KỸ NĂNG ĐÊM)
    async transitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        try {
            // Phân giải các hành động đêm đồng thời bằng Tick Engine chuyên dụng
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);

            const updates = {};
            updates[`rooms/${Net.roomId}/meta/phase`] = "day";

            // Cập nhật trạng thái sinh mệnh của người chơi tử vong trong đêm
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Ghi nhận và lưu các bùa chú bổ trợ hoặc thay đổi sinh mệnh đêm từ Tick Engine
            for (const [playerId, fields] of Object.entries(resolutionOutcome.playerStateUpdates)) {
                for (const [fieldKey, val] of Object.entries(fields)) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/${fieldKey}`] = val;
                }
            }

            // Phân phối kết quả đêm vào Mailbox cá nhân của từng người chơi
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

            // Đồng bộ toàn bộ dữ liệu trạng thái mới lên server Firebase
            await update(ref(db), updates);

            // Ghi nhật ký công khai cho toàn làng hiển thị tại Log Box công cộng
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh rạng rỡ! Một đêm yên bình trôi qua, không có ai bị hạ sát trong bóng tối.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => Net.players[id]?.name || "Ẩn danh").join(", ");
                announcement = `☀️ Bình minh rạng rỡ! Đêm qua vương quốc ghi nhận ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");

            // Kiểm tra điều kiện thắng trận ngay sau khi bình minh hé rạng
            await StateMachine.checkVictoryConditions();

        } catch (error) {
            console.error("Lỗi tiến trình phân giải đêm đen:", error);
            showToast("Có lỗi xảy ra khi tính toán kết quả đêm!", "danger");
        }
    },

    // 5. PHÂN GIẢI PHÁN QUYẾT BỎ PHIẾU TREO CỔ (VOTING RESOLUTION)
    async resolveVotingOutcome() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        // Tránh thực thi trùng lặp khi nhận onValue phản hồi dồn dập
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

            // Kích hoạt hoạt ảnh búa gõ phán quyết đồng nhất cho tất cả Client
            runGavelStrikeAnimation(decisionText, async () => {
                const finalUpdates = {};
                if (executeTarget) {
                    finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                    await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết thi hành án treo cổ đối tượng [${accusedName}].`, "kill");
                } else {
                    await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết tha bổng hoàn toàn cho [${accusedName}].`, "sys");
                }

                // Dọn dẹp trạng thái biểu quyết cũ
                finalUpdates[`rooms/${Net.roomId}/trial`] = {
                    stage: "none",
                    accusedId: null,
                    accusedText: "",
                    decisionText: ""
                };
                finalUpdates[`rooms/${Net.roomId}/votes`] = null;
                finalUpdates[`rooms/${Net.roomId}/nominations`] = null;

                await update(ref(db), finalUpdates);
                
                // Mở khóa phân giải cho lượt tiếp theo
                isResolvingVote = false;

                // Kiểm tra điều kiện thắng sau phán quyết treo cổ
                await StateMachine.checkVictoryConditions();
            });

        } catch (error) {
            console.error("Gặp sự cố khi phân giải phiếu biểu quyết:", error);
            isResolvingVote = false;
        }
    },

    // 6. KIỂM TRÁ ĐIỀU KIỆN THẮNG TRẬN (VICTORY CHECK CONDITIONS)
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

            // Kịch bản 1: Phe Sói chiếm ưu thế tuyệt đối
            if (wolvesAlive >= villagersAlive + thirdsAlive) {
                winner = "wolf";
            }
            // Kịch bản 2: Toàn bộ Ma Sói và phe thứ 3 nguy hại bị quét sạch
            else if (wolvesAlive === 0 && thirdsAlive === 0) {
                winner = "villager";
            }
            // Kịch bản 3: Phe Thứ Ba áp đảo và loại bỏ hai phe chính diện
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                // Khởi tạo gói dữ liệu thống kê tổng kết MVP mẫu
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