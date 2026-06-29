import { db, ref, get } from "./firebase-config.js";
import { ROLE_DB } from "./game-logic.js";

export const TickEngine = {
    // PHÂN GIẢI TOÀN BỘ HÀNH ĐỘNG ĐÊM ĐỒNG THỜI (DETERMINISTIC PRIORITY TICK RESOLUTION)
    async resolveNightActions(roomId) {
        const roomRef = ref(db, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) return { deaths: [], mailboxDeliveries: {} };

        const roomData = snapshot.val();
        const playersMap = roomData.players || {};
        const playersList = Object.values(playersMap);

        // Khởi tạo các mảng kiểm soát trạng thái cuối cùng
        const deathsSet = new Set();
        const mailboxDeliveries = {}; // Cấu trúc: { [playerId]: [ {title, content, category} ] }
        
        const initMailbox = (pid) => {
            if (!mailboxDeliveries[pid]) mailboxDeliveries[pid] = [];
        };

        // Danh sách hỗ trợ phân giải nhanh
        const protectedPlayers = new Set();
        const mirrorsMap = {}; // Phản chiếu: { [Bị_nhắm_mục_tiêu]: [Người_đặt_gương] }
        const silencesMap = new Set();
        const convertedPlayers = new Set();
        const trappedPlayers = {}; // Kẻ bẫy Eradicator: { [EradicatorId]: TargetId }

        // Mảng gom toàn bộ lệnh hành động đêm gửi lên từ client
        let actionBuffer = [];

        playersList.forEach(p => {
            if (p.alive && p.targetSelection) {
                actionBuffer.push({
                    srcId: p.id,
                    role: p.role,
                    actionType: p.targetSelection.actionType, // ví dụ: "seer_scan", "guard_protect", "wolf_bite"
                    targetId: p.targetSelection.targetId,
                    secondaryId: p.targetSelection.secondaryId
                });
            }
        });

        // ==========================================
        // TICK 1: ĐÁNH TRÁO & BẪY GIÁM SÁT (IDENTITY SWAPS & TRAPS)
        // ==========================================
        const identitySwaps = {}; // Tráo đổi Tiên tri: { [PlayerA]: PlayerB }
        
        actionBuffer.forEach(act => {
            if (act.role === "phantomWolf" && act.actionType === "identity_swap") {
                identitySwaps[act.targetId] = act.secondaryId;
                identitySwaps[act.secondaryId] = act.targetId;
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🐺] TRÁO ĐỔI NHÂN DẠNG",
                    content: `Đã hoàn thành ảo thuật hoán đổi tâm linh giữa: ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name}.`
                });
            }
            if (act.role === "eradicator" && act.actionType === "set_trap") {
                trappedPlayers[act.srcId] = act.targetId;
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[⚔️] PHÒNG THỦ THANH TRỪNG",
                    content: `Hệ thống đã ghi nhận mục tiêu giám sát phòng vệ: ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // ==========================================
        // TICK 2: THAO TÚNG BẺ HƯỚNG MỤC TIÊU (REDIRECTION)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "manipulator" && act.actionType === "redirect") {
                // Thay đổi điểm đích của mục tiêu bị thao túng
                actionBuffer.forEach(subAct => {
                    if (subAct.srcId === act.targetId) {
                        subAct.targetId = act.secondaryId;
                    }
                });
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪄] THAO TÚNG BIÊN DỊCH",
                    content: `Đã bẻ hướng phép thuật thành công của ${playersMap[act.targetId]?.name} sang mục tiêu ${playersMap[act.secondaryId]?.name}.`
                });
            }
        });

        // ==========================================
        // TICK 3: BẢO VỆ & THIẾT LẬP PHẢN CHIẾU (PROTECTIONS & REFLECTIONS)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "guard" && act.actionType === "protect") {
                protectedPlayers.add(act.targetId);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🛡️] NHẬT KÝ TUẦN TRA ĐÊM",
                    content: `Bạn đã tuần tra xung quanh nhà và thiết lập lá chắn bảo hộ an toàn cho ${playersMap[act.targetId]?.name}.`
                });
            }
            if (act.role === "reflector" && act.actionType === "set_mirror") {
                mirrorsMap[act.targetId] = act.srcId; // Ai phép thuật nhắm vào targetId sẽ bị phản ngược về reflector srcId
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪞] KÍNH PHẢN QUANG ĐÃ DỰNG",
                    content: `Thiết lập gương phản đòn thành công trước cửa nhà ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // Đệ quy phân giải phản chiếu thông minh (Tránh lỗi đệ quy vô hạn khi Gương đẩy nhau)
        const getFinalTargetWithReflection = (casterId, initialTargetId, visited = new Set()) => {
            if (visited.has(initialTargetId)) {
                return null; // Chu trình lặp vô hạn phát hiện! Năng lượng triệt tiêu hoàn toàn.
            }
            visited.add(initialTargetId);
            if (mirrorsMap[initialTargetId]) {
                const reflectorId = mirrorsMap[initialTargetId];
                return getFinalTargetWithReflection(casterId, reflectorId, visited);
            }
            return initialTargetId;
        };

        // Áp dụng định tuyến phản chiếu lên toàn bộ đệm hành động
        actionBuffer.forEach(act => {
            if (act.actionType !== "set_mirror" && act.actionType !== "protect") {
                const routedTarget = getFinalTargetWithReflection(act.srcId, act.targetId);
                if (routedTarget === null) {
                    act.targetId = "neutralized_by_void"; // Phép bị hấp thụ
                } else {
                    act.targetId = routedTarget;
                }
            }
        });

        // ==========================================
        // TICK 4: KHÓA PHÉP & CÂM LẶNG (BLOCKS / SILENCE)
        // ==========================================
        const blockedCasters = new Set();

        actionBuffer.forEach(act => {
            if (act.role === "silencerWolf" && act.actionType === "silence") {
                silencesMap.add(act.targetId);
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🤫] KHÓA MÕM BĂNG KHÍ",
                    content: "Cổ họng bạn bị đông cứng bởi Sói Câm Lặng! Sáng nay bạn không được phát ngôn thảo luận."
                });
            }
            if (act.role === "avenger" && act.actionType === "anesthetize") {
                blockedCasters.add(act.targetId);
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💤] TRẠNG THÁI GÂY MÊ",
                    content: "Bạn dính thuốc mê của Kẻ Báo Thù! Toàn bộ năng lực đêm nay bị hủy bỏ."
                });
            }
        });

        // Khóa các caster bị chặn hành động
        actionBuffer = actionBuffer.filter(act => !blockedCasters.has(act.srcId));

        // ==========================================
        // TICK 5: THIẾT LẬP LIÊN KẾT & THU PHỤC (ALIGNMENT SHIFT)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "cupid" && act.actionType === "link_lovers") {
                initMailbox(act.targetId);
                initMailbox(act.secondaryId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💘] MŨI TÊN ÁI TÌNH ĐÃ GHIM",
                    content: `Mũi tên Cupid đã buộc sinh mệnh của bạn vĩnh viễn với ${playersMap[act.secondaryId]?.name}.`
                });
                mailboxDeliveries[act.secondaryId].push({
                    title: "[💘] MŨI TÊN ÁI TÌNH ĐÃ GHIM",
                    content: `Mũi tên Cupid đã buộc sinh mệnh của bạn vĩnh viễn với ${playersMap[act.targetId]?.name}.`
                });
            }
            if (act.role === "missionary" && act.actionType === "convert") {
                convertedPlayers.add(act.targetId);
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🕍] LỜI KÊU GỌI TỪ THÁNH ĐƯỜNG",
                    content: "Tâm trí bạn đã bị Nhà Truyền Giáo thu phục. Hãy giúp đức tin của họ tồn tại!"
                });
            }
        });

        // ==========================================
        // TICK 6: SÁT THƯƠNG VÀ ĐỒNG BỘ PHÂN GIẢI TỬ VONG (LETHAL ACTIONS)
        // ==========================================
        const attackedTargets = new Set();
        let witchSavedTarget = null;
        const witchPoisonedTarget = new Set();

        // Thu thập thông tin hành động của Phù thủy trước
        actionBuffer.forEach(act => {
            if (act.role === "witch") {
                if (act.actionType === "use_heal") witchSavedTarget = act.targetId;
                if (act.actionType === "use_poison") witchPoisonedTarget.add(act.targetId);
            }
        });

        // Tính toán các nguồn sát thương
        actionBuffer.forEach(act => {
            // Sói cắn
            if (act.role === "wolf" || act.actionType === "wolf_bite") {
                attackedTargets.add(act.targetId);
            }
            // Sát nhân ra tay
            if (act.role === "serialKiller" && act.actionType === "serial_kill") {
                attackedTargets.add(act.targetId);
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🔪] KẺ SÁT NHÂN CUỒNG LOẠN",
                    content: "Đêm qua một tên sát nhân máu lạnh đã đột nhập phòng ngủ và lấy mạng bạn dã man!"
                });
            }
        });

        // Kiểm tra xem ai bị dính sát thương thực sự (Sau khi trừ Bảo Vệ & Bình Cứu)
        attackedTargets.forEach(targetId => {
            if (targetId === witchSavedTarget) {
                // Được cứu bởi Phù thủy
                return;
            }
            if (protectedPlayers.has(targetId)) {
                // Được Bảo vệ che chở thành công
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🛡️] THƯ CỨU NẠN BÓNG ĐÊM",
                    content: "Đêm qua thế lực hắc ám đã cào nát cửa nhà bạn, nhưng lá chắn của Bảo Vệ đã che chở cho bạn an toàn!"
                });
                return;
            }
            // Tử vong
            deathsSet.add(targetId);
        });

        // Xử lý ném Độc của phù thủy (Độc bỏ qua khiên bảo vệ của Guard)
        witchPoisonedTarget.forEach(targetId => {
            deathsSet.add(targetId);
            initMailbox(targetId);
            mailboxDeliveries[targetId].push({
                title: "[☠️] BẢN ÁN TỬ PHÙ THỦY",
                content: "Một cơn đau thắt tim đột ngột xảy ra. Bình độc dược của Phù Thủy đã tước đi sinh mạng của bạn!"
            });
        });

        // ==========================================
        // TICK 7: PHẢN PHÁT SÚNG THỢ SĂN (DEATH RETALIATION)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "hunter" && deathsSet.has(act.srcId)) {
                // Nếu thợ săn chết, phát súng ghim mục tiêu lập tức nổ
                deathsSet.add(act.targetId);
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🏹] PHÁT BẮN CUỐI CÙNG",
                    content: `Thợ Săn đã ngã xuống, nhưng phát súng ghim của hắn đã trúng tim kéo bạn chết theo!`
                });
            }
        });

        // ==========================================
        // TIỆN ÍCH DÀNH RIÊNG CHO TIÊN TRI (SEER SCAN RESOLUTION)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "seer" && act.actionType === "seer_scan") {
                const originalTarget = act.targetId;
                // Áp dụng ảo ảnh Phantom Wolf hoán đổi nếu có dính
                const finalTargetId = identitySwaps[originalTarget] || originalTarget;
                const targetPlayer = playersMap[finalTargetId];
                
                let factionResult = "🌾 PHE DÂN LÀNG 🌾";
                if (targetPlayer && targetPlayer.realFaction === "wolf") {
                    factionResult = "🐺 PHE MA SÓI 🐺";
                } else if (targetPlayer && targetPlayer.realFaction === "third") {
                    factionResult = "🧛 PHE THỨ BA 🧛";
                }

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🔮] KẾT QUẢ THẤU THỊ",
                    content: `Phép thuật hoàn tất! Quả cầu pha lê hiển thị linh hồn của ${playersMap[originalTarget]?.name} thuộc về: ${factionResult}.`
                });
            }
        });

        return {
            deaths: Array.from(deathsSet),
            mailboxDeliveries: mailboxDeliveries
        };
    }
};