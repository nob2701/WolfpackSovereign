import { db, ref, get, update, runTransaction } from "./firebase-config.js";
import { Engine_Module } from "./game-logic.js";
import { TickEngine } from "./tick-engine.js";
import { runGavelStrikeAnimation, showToast } from "./ui-manager.js";

// Khóa trạng thái cục bộ bảo vệ luồng bất đồng bộ trên Client
let isTransitioning = false;
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
        if (isTransitioning) return;

        isTransitioning = true;
        
        try {
            // SỬ DỤNG TRANSACTIONS ĐỂ KHÓA PHÂN GIẢI TRÁNH GỬI TRÙNG LẶP SỰ KIỆN (BUG 13)
            let success = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/meta`), (meta) => {
                if (!meta) return meta;
                if (meta.phase === "night") return; // Đã là ban đêm, hủy bỏ tránh ghi đè lặp
                meta.phase = "night";
                meta.day = (meta.day || 0) + 1;
                success = true;
                return meta;
            });

            if (!success) {
                isTransitioning = false;
                return;
            }

            // Đọc cấu hình danh sách người chơi hiện tại để lập chỉ mục lượt hành động
            const snap = await get(ref(db, `rooms/${Net.roomId}/players`));
            if (snap.exists()) {
                const players = snap.val();
                const updates = {};
                
                // DỌN SẠCH DỮ LIỆU ĐỀ CỬ & VOTE CŨ ĐỂ CHỐNG VÒNG LẶP VÔ HẠN (BUG 1)
                updates[`rooms/${Net.roomId}/votes`] = null;
                updates[`rooms/${Net.roomId}/nominations`] = null;
                updates[`rooms/${Net.roomId}/trial`] = {
                    stage: "none",
                    accusedId: null,
                    accusedText: "",
                    decisionText: ""
                };

                // Thiết lập lại trạng thái xong lượt cho từng người chơi sống sót
                Object.entries(players).forEach(([playerId, player]) => {
                    updates[`rooms/${Net.roomId}/players/${playerId}/targetSelection`] = null;
                    
                    if (!player.alive) {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                    } else if (PASSIVE_NIGHT_ROLES.includes(player.role)) {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = true;
                    } else {
                        updates[`rooms/${Net.roomId}/players/${playerId}/turnEnded`] = false;
                    }
                });

                await update(ref(db), updates);

                // Lấy thông số ngày thực tế sau khi lưu transaction để ghi nhật ký
                const currentDaySnap = await get(ref(db, `rooms/${Net.roomId}/meta/day`));
                const nextDay = currentDaySnap.val() || 1;
                await Engine_Module.logMsg(`🌙 Bóng đêm bao phủ vương quốc. Đêm thứ ${nextDay} bắt đầu!`, "sys");
            }
        } catch (error) {
            console.error("Gặp sự cố khi chuyển đổi sang pha đêm:", error);
            showToast("Không thể đồng bộ pha đêm sang máy chủ!", "danger");
        } finally {
            isTransitioning = false;
        }
    },

    // 2. KIỂM TRA ĐỒNG BỘ TỰ ĐỘNG CHUYỂN NGÀY
    async checkAndAutoTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        const playersRef = ref(db, `rooms/${Net.roomId}/players`);
        try {
            const snap = await get(playersRef);
            if (!snap.exists()) return;
            
            const players = Object.values(snap.val() || {});
            const alivePlayers = players.filter(p => p.alive);

            // Kiểm tra xem toàn bộ người sống đã hoàn thành hành động hay chưa
            const allTurnsEnded = alivePlayers.every(p => p.turnEnded === true);

            if (allTurnsEnded) {
                await StateMachine.transitionToDay();
            }
        } catch (error) {
            console.error("Lỗi khi quét trạng thái hoàn thành lượt:", error);
        }
    },

    // 3. CƯỠNG CHẾ CHUYỂN SANG BAN NGÀY CỦA QUẢN TRÒ
    async forceTransitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;
        
        try {
            await Engine_Module.logMsg("⚠️ Quản trò đã cưỡng chế kết thúc đêm đen sớm để duy trì nhịp độ trận đấu!", "kill");
            await StateMachine.transitionToDay();
        } catch (error) {
            console.error("Lỗi khi cưỡng chế chuyển ngày:", error);
        }
    },

    // 4. CHUYỂN SANG PHA NGÀY VÀ PHÂN GIẢI KỸ NĂNG ĐÊM ĐỒNG THỜI
    async transitionToDay() {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        if (isTransitioning) return;

        isTransitioning = true;
        
        try {
            // SỬ DỤNG TRANSACTION ĐỂ NGĂN PHÂN GIẢI ĐÊM ĐƠN 2 LẦN (BUG 13)
            let success = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/meta/phase`), (phase) => {
                if (phase === "day") return; // Đã chuyển sang ngày rồi, hủy tác vụ
                success = true;
                return "day";
            });

            if (!success) {
                isTransitioning = false;
                return;
            }

            // Thực thi bộ lọc và phân giải đồng thời bằng Tick Engine chuyên dụng
            const resolutionOutcome = await TickEngine.resolveNightActions(Net.roomId);
            const updates = {};

            // Lưu trữ thông tin tử vong thực tế sau phân giải đêm
            resolutionOutcome.deaths.forEach(deadPlayerId => {
                updates[`rooms/${Net.roomId}/players/${deadPlayerId}/alive`] = false;
            });

            // Ghi nhận các trạng thái bùa chú bổ trợ mới lên Firebase
            for (const [playerId, fields] of Object.entries(resolutionOutcome.playerStateUpdates)) {
                for (const [fieldKey, val] of Object.entries(fields)) {
                    updates[`rooms/${Net.roomId}/players/${playerId}/${fieldKey}`] = val;
                }
            }

            // Gửi mật thư thông báo kết quả chức năng vào Mailbox của từng người chơi
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

            // Ghi nhật ký công cộng thông báo tình hình bình minh
            let announcement = "";
            if (resolutionOutcome.deaths.length === 0) {
                announcement = "☀️ Bình minh rạng rỡ! Một đêm yên bình trôi qua, không có ai bị hạ sát trong bóng tối.";
            } else {
                const deadNames = resolutionOutcome.deaths.map(id => Net.players[id]?.name || "Ẩn danh").join(", ");
                announcement = `☀️ Bình minh rạng rỡ! Đêm qua vương quốc ghi nhận ${resolutionOutcome.deaths.length} người tử vong: ${deadNames}`;
            }

            await Engine_Module.logMsg(announcement, "info");

            // Tự động kiểm tra điều kiện kết thúc trận đấu
            await StateMachine.checkVictoryConditions();

        } catch (error) {
            console.error("Lỗi tiến trình phân giải đêm đen:", error);
            showToast("Có lỗi xảy ra khi tính toán kết quả đêm!", "danger");
        } finally {
            isTransitioning = false;
        }
    },

    // 5. PHÂN GIẢI PHÁN QUYẾT BỎ PHIẾU TREO CỔ
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

            if (!trial.accusedId || trial.stage !== "vote") {
                isResolvingVote = false;
                return;
            }

            let countAcquit = 0;
            let countExecute = 0;

            // SỬA LỖI NGƯỜI CHẾT BẦU SỐ PHẬN (BUG 12): Chỉ chấp nhận phiếu của người chơi còn sống!
            Object.entries(votes).forEach(([voterId, voteValue]) => {
                const voter = roomData.players[voterId];
                if (voter && voter.alive) {
                    if (voteValue === "ACQUIT") countAcquit++;
                    if (voteValue === "EXECUTE") countExecute++;
                }
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

            // Chuyển giai đoạn xử án sang phán quyết (Verdict) atomically để tránh race condition
            let allowed = false;
            await runTransaction(ref(db, `rooms/${Net.roomId}/trial/stage`), (stage) => {
                if (stage === "verdict") return; // Đã được xử lý bởi máy khách khác
                allowed = true;
                return "verdict";
            });

            if (!allowed) {
                isResolvingVote = false;
                return;
            }

            // Cập nhật văn bản công bố phán quyết lên máy chủ
            await update(ref(db, `rooms/${Net.roomId}/trial`), {
                decisionText: decisionText
            });

            // Kích hoạt hoạt ảnh gõ búa phán quyết tòa án đồng nhất cho tất cả các Client
            runGavelStrikeAnimation(decisionText, async () => {
                try {
                    const finalUpdates = {};
                    if (executeTarget) {
                        finalUpdates[`rooms/${Net.roomId}/players/${trial.accusedId}/alive`] = false;
                        await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết thi hành án treo cổ đối tượng [${accusedName}].`, "kill");
                    } else {
                        await Engine_Module.logMsg(`⚖️ Dân làng đã phán quyết tha bổng hoàn toàn cho [${accusedName}].`, "sys");
                    }

                    // Dọn dẹp hoàn toàn vết tích trạng thái phiên tòa xét xử cũ
                    finalUpdates[`rooms/${Net.roomId}/trial`] = {
                        stage: "none",
                        accusedId: null,
                        accusedText: "",
                        decisionText: ""
                    };
                    finalUpdates[`rooms/${Net.roomId}/votes`] = null;
                    finalUpdates[`rooms/${Net.roomId}/nominations`] = null;

                    await update(ref(db), finalUpdates);
                    
                    // Quét kiểm tra điều kiện thắng trận ngay sau thi hành án
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

    // 6. KIỂM TRA ĐIỀU KIỆN CHIẾN THẮNG TRẬN ĐẤU
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

            // Kịch bản 1: Ma Sói có số lượng áp đảo tuyệt đối
            if (wolvesAlive >= villagersAlive + thirdsAlive) {
                winner = "wolf";
            }
            // Kịch bản 2: Ma Sói và toàn bộ thế lực thứ 3 phá hoại bị tiêu diệt sạch
            else if (wolvesAlive === 0 && thirdsAlive === 0) {
                winner = "villager";
            }
            // Kịch bản 3: Phe Thứ Ba có số lượng áp đảo và dọn dẹp sạch 2 phe đối kháng chính
            else if (thirdsAlive > 0 && villagersAlive === 0 && wolvesAlive === 0) {
                winner = "third";
            }

            if (winner) {
                // Thiết lập gói phân tích MVP giả định tối giản
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