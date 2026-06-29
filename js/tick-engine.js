import { db, ref, get } from "./firebase-config.js";
import { ROLE_DB } from "./game-logic.js";

export const TickEngine = {
    // PHÂN GIẢI TOÀN BỘ HÀNH ĐỘNG ĐÊM ĐỒNG THỜI (DETERMINISTIC 8-TICK PRIORITY RESOLUTION)
    async resolveNightActions(roomId) {
        const roomRef = ref(db, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) return { deaths: [], mailboxDeliveries: {} };

        const roomData = snapshot.val();
        const playersMap = roomData.players || {};
        const playersList = Object.values(playersMap);

        // Mảng gom toàn bộ lệnh hành động đêm gửi lên từ client
        let actionBuffer = [];
        playersList.forEach(p => {
            if (p.alive && p.targetSelection) {
                actionBuffer.push({
                    srcId: p.id,
                    role: p.role,
                    actionType: p.targetSelection.actionType, 
                    targetId: p.targetSelection.targetId,
                    secondaryId: p.targetSelection.secondaryId || null,
                    phrase: p.targetSelection.phrase || ""
                });
            }
        });

        // Khởi tạo các cấu trúc lưu trữ trạng thái cuối cùng
        const deathsSet = new Set();
        const mailboxDeliveries = {}; // Cấu trúc: { [playerId]: [ {title, content, category} ] }
        
        const initMailbox = (pid) => {
            if (!mailboxDeliveries[pid]) mailboxDeliveries[pid] = [];
        };

        // Biến bổ trợ kiểm soát xuyên suốt các bước
        const purifiedPlayers = new Set();      // Đối tượng được Thiên Sứ thanh tấy
        const identitySwaps = {};              // Tráo đổi Tiên tri: { [PlayerA]: PlayerB }
        const trappedPlayers = {};             // Eradicator sập bẫy: { [EradicatorId]: TargetId }
        const protectedPlayers = new Set();    // Bảo Vệ tuần tra thành công
        const primeFollowers = new Set();      // Thân cận Chủ Thần được bảo hộ
        const mirrorsMap = {};                 // Phản chiếu: { [Bị_nhắm_mục_tiêu]: [Người_đặt_gương] }
        const blockedCasters = new Set();      // Người chơi bị Gây Mê hoặc Phong Ấn lượt
        const silencedPlayers = new Set();     // Người chơi bị câm lặng tiếp theo
        const convertedPlayers = new Set();    // Tín đồ bị thu phục
        const vampireBittenPlayers = new Set(); // Nạn nhân bị Vampire cắn
        const petrolMarks = roomData.petrolMarks || {}; // Giữ trạng thái xăng cũ từ cơ sở dữ liệu
        const newlyPetroled = new Set();       // Các nhà vừa bị tưới xăng đêm nay

        // ==========================================
        // TICK 1: THANH TẨY & GIẢI TRỪ TRẠNG THÁI (ANGEL PURIFICATION)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "angel" && act.actionType === "purify") {
                purifiedPlayers.add(act.targetId);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[👼] SỨ MỆNH KHAI SÁNG",
                    content: `Bạn đã tịnh hóa thành công cho ${playersMap[act.targetId]?.name}, loại bỏ hoàn toàn bùa chú bất lợi khỏi linh hồn họ.`
                });
                
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[👼] ÁNH SÁNG TỊNH HÓA",
                    content: "Một vầng hào quang ấm áp rọi xuống thể xác bạn. Toàn bộ bùa chú câm lặng, phong ấn hay xăng dầu bám trên người bạn đã bị Thiên Sứ gột rửa sạch sẽ!",
                    category: "system"
                });
            }
        });

        // ==========================================
        // TICK 2: ĐÁNH TRÁO NHÂN DẠNG, BẺ HƯỚNG & ĐẶT BẪY (SWAPS, REDIRECTIONS & TRAPS)
        // ==========================================
        // 2.1 Sói Ảo Ảnh (Phantom Wolf) tráo đổi
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
        });

        // 2.2 Kẻ Thao Túng (The Manipulator) redirect
        actionBuffer.forEach(act => {
            if (act.role === "manipulator" && act.actionType === "redirect") {
                actionBuffer.forEach(subAct => {
                    if (subAct.srcId === act.targetId) {
                        subAct.targetId = act.secondaryId; // Đổi hướng mục tiêu gốc
                    }
                });
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪄] THAO TÚNG BIÊN DỊCH",
                    content: `Đã bẻ hướng thành công kỹ năng của ${playersMap[act.targetId]?.name} dội sang mục tiêu ${playersMap[act.secondaryId]?.name}.`
                });
            }
        });

        // 2.3 Kẻ Thanh Trừng (Eradicator) đặt bẫy
        actionBuffer.forEach(act => {
            if (act.role === "eradicator" && act.actionType === "set_trap") {
                trappedPlayers[act.srcId] = [act.targetId, act.secondaryId];
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[⚔️] THIẾT LẬP PHÒNG THỦ THANH TRỪNG",
                    content: `Hệ thống đã ghi nhận 2 mục tiêu giám sát phòng vệ đêm nay: ${playersMap[act.targetId]?.name} & ${playersMap[act.secondaryId]?.name}.`
                });
            }
        });

        // ==========================================
        // TICK 3: BẢO VỆ & THIẾT LẬP PHẢN CHIẾU (PROTECTIONS & REFLECTIONS)
        // ==========================================
        // 3.1 Thiết lập Bảo Vệ (Guard) và Chủ Thần (Prime)
        actionBuffer.forEach(act => {
            if (act.role === "guard" && act.actionType === "protect") {
                protectedPlayers.add(act.targetId);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🛡️] NHẬT KÝ TUẦN TRA ĐÊM",
                    content: `Bạn đã tuần tra xung quanh nhà và thiết lập lá chắn bảo hộ an toàn cho ${playersMap[act.targetId]?.name}.`
                });
            }
            if (act.role === "prime" && act.actionType === "link_followers") {
                primeFollowers.add(act.targetId);
                primeFollowers.add(act.secondaryId);
                
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🌌] THIẾT LẬP KHẾ ƯỚC CHỦ THẦN",
                    content: `Khế ước linh hồn hoàn tất! Thần dân ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name} đã chính thức trở thành Thân Cận.`
                });

                [act.targetId, act.secondaryId].forEach(followerId => {
                    initMailbox(followerId);
                    mailboxDeliveries[followerId].push({
                        title: "[🌌] KHẾ ƯỚC TỐI CAO",
                        content: "Bạn đã được chọn làm Thân Cận của Chủ Thần tối cao! Bạn được ngài che chở bảo vệ khỏi đòn cắn của Sói."
                    });
                });
            }
        });

        // 3.2 Thiết lập Kẻ Phản Chiếu (The Reflector)
        actionBuffer.forEach(act => {
            if (act.role === "reflector" && act.actionType === "set_mirror") {
                mirrorsMap[act.targetId] = act.srcId; 
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪞] KÍNH PHẢN QUANG ĐÃ DỰNG",
                    content: `Thiết lập bảo vệ phản đòn thành công trước cửa nhà của ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // Xử lý phản chiếu mục tiêu phép thuật thông minh thông qua mirrorsMap
        const getRoutedTarget = (casterId, currentTargetId, visited = new Set()) => {
            if (visited.has(currentTargetId)) return "neutralized_by_void"; 
            visited.add(currentTargetId);
            if (mirrorsMap[currentTargetId] && mirrorsMap[currentTargetId] !== casterId) {
                return getRoutedTarget(casterId, mirrorsMap[currentTargetId], visited);
            }
            return currentTargetId;
        };

        actionBuffer.forEach(act => {
            if (act.actionType !== "set_mirror" && act.actionType !== "protect") {
                act.targetId = getRoutedTarget(act.srcId, act.targetId);
            }
        });

        // ==========================================
        // TICK 4: KHÓA PHÉP & CÂM LẶNG (BLOCKS & SILENCE)
        // ==========================================
        actionBuffer.forEach(act => {
            // Sói Câm Lặng (Silencer Wolf)
            if (act.role === "silencerWolf" && act.actionType === "silence") {
                if (!purifiedPlayers.has(act.targetId)) {
                    silencedPlayers.add(act.targetId);
                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🤫] VUỐT TĨNH LẶNG",
                        content: `Bạn đã khóa miệng thành công đối tượng: ${playersMap[act.targetId]?.name} cho ngày mai.`
                    });
                    initMailbox(act.targetId);
                    mailboxDeliveries[act.targetId].push({
                        title: "[🤫] KHÓA MÕM BĂNG KHÍ",
                        content: "Cổ họng bạn bị đông cứng bởi luồng vuốt băng khí của Sói Câm Lặng! Sáng nay bạn không thể phát ngôn thảo luận."
                    });
                }
            }
            // Gây mê của Kẻ Báo Thù (Avenger) hoặc Phong Ấn của Mèo (Cat)
            if ((act.role === "avenger" && act.actionType === "anesthetize") || (act.role === "cat" && act.actionType === "seal")) {
                blockedCasters.add(act.targetId);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: `[⚡] KHÓA LUỒNG MA PHÁP`,
                    content: `Đã niêm phong hoàn toàn năng lực phép thuật của ${playersMap[act.targetId]?.name} thành công.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💤] TRẠNG THÁI GÂY MÊ",
                    content: "Kỹ năng đêm nay của bạn bị phong tỏa vô hiệu! Bạn buộc phải ngủ say qua lượt này."
                });
            }
        });

        // Loại bỏ các lệnh hành động từ những Caster bị khóa phép đêm nay
        actionBuffer = actionBuffer.filter(act => !blockedCasters.has(act.srcId));

        // ==========================================
        // TICK 5: LIÊN KẾT & THU PHỤC ĐỒNG MINH (ALIGNMENT SHIFT & LINKS)
        // ==========================================
        actionBuffer.forEach(act => {
            // Cupid se duyên
            if (act.role === "cupid" && act.actionType === "link_lovers") {
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[💘] THẮT NÚT TƠ HỒNG",
                    content: `Bạn đã hoàn thành nhiệm vụ se duyên cho cặp đôi: ${playersMap[act.targetId]?.name} & ${playersMap[act.secondaryId]?.name}.`
                });

                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💘] MŨI TÊN ÁI TÌNH ĐÃ GHIM",
                    content: `Mũi tên vàng của Cupid đã buộc sinh mệnh của bạn vĩnh viễn với ${playersMap[act.secondaryId]?.name}!`
                });

                initMailbox(act.secondaryId);
                mailboxDeliveries[act.secondaryId].push({
                    title: "[💘] MŨI TÊN ÁI TÌNH ĐÃ GHIM",
                    content: `Mũi tên vàng của Cupid đã buộc sinh mệnh của bạn vĩnh viễn với ${playersMap[act.targetId]?.name}!`
                });
            }

            // Nhà Truyền Giáo (Missionary) thu phục
            if (act.role === "missionary" && act.actionType === "convert") {
                convertedPlayers.add(act.targetId);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🕍] TÍN ĐỒ MỚI ĐẦU QUÂN",
                    content: `Đối tượng ${playersMap[act.targetId]?.name} đã chính thức quy thuận và gia nhập giáo hội.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🕍] LỜI KÊU GỌI TỪ THÁNH ĐƯỜNG",
                    content: "Tâm trí bạn đột ngột bị khai sáng bởi Nhà Truyền Giáo! Bạn đã bị thu phục vào giáo phái."
                });
            }

            // Vampire hút máu
            if (act.role === "vampire" && act.actionType === "bite") {
                vampireBittenPlayers.add(act.targetId);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🧛] HUYẾT LỆNH ĐÊM ĐEN",
                    content: `Vết nanh vuốt bóng đêm đã được ghi nhận trên cơ thể của ${playersMap[act.targetId]?.name}.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🩸] VẾT CẮN BÓNG ĐÊM",
                    content: "Đêm qua một Vampire đã ghé thăm phòng ngủ của bạn và để lại vết cắn nguyền rủa râm ran đau nhức!"
                });
            }

            // Nói nhái của Vẹt (Parrot)
            if (act.role === "parrot" && act.actionType === "mimic") {
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🦜] LỜI NGUYỀN SAO CHÉP",
                    content: `Đã ép buộc ${playersMap[act.targetId]?.name} phải lặp lại câu thoại: '${act.phrase}' vào sáng mai.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🦜] LỜI NGUYỀN GHI ÂM",
                    content: `Cổ họng bạn bị điều khiển bởi bùa chú của Vẹt! Bạn buộc phải thốt ra câu: "${act.phrase}" sáng mai để giải tỏa.`
                });
            }
        });

        // ==========================================
        // TICK 6: SÁT THƯƠNG ĐỒNG THỜI (DAMAGE RESOLUTION)
        // ==========================================
        const damageQueue = []; // Chứa danh sách đối tượng bị tấn công: { targetId, sourceRole }
        let witchHealTarget = null;
        const witchPoisonTargets = new Set();

        // 6.1 Thu thập thông tin hành động của Phù thủy (Witch) trước để làm bộ lọc
        actionBuffer.forEach(act => {
            if (act.role === "witch") {
                if (act.actionType === "heal") witchHealTarget = act.targetId;
                if (act.actionType === "poison") witchPoisonTargets.add(act.targetId);
            }
        });

        // 6.2 Gom toàn bộ nguồn gây sát thương đêm nay
        actionBuffer.forEach(act => {
            if (act.role === "wolf" || act.actionType === "wolf_bite") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "wolf" });
            }
            if (act.role === "serialKiller" && act.actionType === "serial_kill") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "serialKiller" });
            }
            if (act.role === "avenger" && act.actionType === "execute") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "avenger" });
            }
            if (act.role === "cat" && act.actionType === "tear") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "cat" });
            }
        });

        // 6.3 Áp dụng cơ chế tẩm xăng và phóng hỏa của Kẻ Phóng Hỏa (Arsonist)
        actionBuffer.forEach(act => {
            if (act.role === "arsonist") {
                if (act.actionType === "pour_petrol") {
                    newlyPetroled.add(act.targetId);
                    if (act.secondaryId) newlyPetroled.add(act.secondaryId);
                } else if (act.actionType === "ignite") {
                    // Châm lửa thiêu đốt tất cả nhà dính xăng (Sát thương tuyệt đối)
                    playersList.forEach(p => {
                        if (p.isPetroled || newlyPetroled.has(p.id)) {
                            damageQueue.push({ targetId: p.id, sourceRole: "arsonist" });
                        }
                    });
                }
            }
        });

        // 6.4 Tính toán phân giải sát thương thực tế
        damageQueue.forEach(dmg => {
            const { targetId, sourceRole } = dmg;

            // Nếu được Phù thủy quăng bình hồi sinh cứu mạng
            if (targetId === witchHealTarget) return;

            // Nếu được Bảo Vệ che chở (Ngoại trừ sát thương tuyệt đối từ thiêu rụi của Arsonist)
            if (protectedPlayers.has(targetId) && sourceRole !== "arsonist") {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🛡️] THƯ CỨU NẠN BÓNG ĐÊM",
                    content: "Đêm qua nanh vuốt và vũ khí sát thương đã bủa vây căn nhà bạn, nhưng lá chắn Bảo Vệ đã che chở cho bạn thành công!"
                });
                return;
            }

            // Nếu là Thân cận của Chủ Thần được miễn nhiễm đòn cắn của Ma Sói
            if (primeFollowers.has(targetId) && sourceRole === "wolf") {
                return;
            }

            // Tử vong thực tế
            deathsSet.add(targetId);
        });

        // 6.5 Phù Thủy ném độc (Độc dược bỏ qua khiên bảo vệ)
        witchPoisonTargets.forEach(targetId => {
            deathsSet.add(targetId);
            initMailbox(targetId);
            mailboxDeliveries[targetId].push({
                title: "[☠️] BẢN ÁN TỬ PHÙ THỦY",
                content: "Một cơn đau thắt tim đột ngột xảy ra. Bình độc dược cực mạnh của Phù Thủy đã tước đi sinh mạng của bạn!"
            });
        });

        // ==========================================
        // TICK 7: PHẢN SÁT & TRẢ ĐÒN CUỐI CÙNG (DEATH RETALIATIONS & LINKS RESOLUTION)
        // ==========================================
        // 7.1 Phát súng kết liễu của Thợ Săn (Hunter) khi ngã xuống
        actionBuffer.forEach(act => {
            if (act.role === "hunter" && deathsSet.has(act.srcId)) {
                deathsSet.add(act.targetId);
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🏹] PHÁT BẮN CUỐI CÙNG",
                    content: `Thợ Săn đã gục ngã, nhưng phát súng ghim của hắn kịp nổ súng kéo bạn chết chung!`
                });
            }
        });

        // 7.2 Sập bẫy phòng vệ sắt gai của Eradicator (Kẻ Thanh Trừng)
        actionBuffer.forEach(act => {
            if (trappedPlayers[act.srcId]) {
                const trapTargets = trappedPlayers[act.srcId];
                actionBuffer.forEach(subAct => {
                    // Nếu một trong các mục tiêu đặt bẫy dám dùng phép lên Eradicator đêm nay
                    if (trapTargets.includes(subAct.srcId) && subAct.targetId === act.srcId) {
                        deathsSet.add(subAct.srcId);
                        initMailbox(subAct.srcId);
                        mailboxDeliveries[subAct.srcId].push({
                            title: "[⚔️] BẪY SẮT KẸP ĐẦU",
                            content: "Bạn dại dột thi triển kỹ năng lên Kẻ Thanh Trừng! Bẫy phòng vệ sắt gai tự động sập xuống kẹp nát cơ thể bạn!"
                        });
                    }
                });
            }
        });

        // ==========================================
        // TICK 8: TRUY XUẤT THÔNG TIN BẢO MẬT (SEER & WOLF MAGE RESOLUTIONS)
        // ==========================================
        actionBuffer.forEach(act => {
            // Tiên tri (Seer) soi
            if (act.role === "seer" && (act.actionType === "seer_scan" || act.actionType === "seer_open_eye")) {
                const originalTarget = act.targetId;
                // Áp dụng ảo ảnh Phantom Wolf hoán đổi nếu có dính
                const finalTargetId = identitySwaps[originalTarget] || originalTarget;
                const targetPlayer = playersMap[finalTargetId];

                initMailbox(act.srcId);
                
                if (act.actionType === "seer_scan") {
                    // Thấu thị phe phái
                    let factionResult = "🌾 PHE DÂN LÀNG 🌾";
                    if (targetPlayer && targetPlayer.realFaction === "wolf") {
                        factionResult = "🐺 PHE MA SÓI 🐺";
                    } else if (targetPlayer && targetPlayer.realFaction === "third") {
                        factionResult = "🧛 PHE THỨ BA 🧛";
                    }
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ THẤU THỊ",
                        content: `Phép thuật hoàn tất! Quả cầu pha lê hiển thị linh hồn của ${playersMap[originalTarget]?.name} thuộc về: ${factionResult}.`
                    });
                } else {
                    // Khai nhãn vai trò thật
                    const realRoleName = targetPlayer ? targetPlayer.role.toUpperCase() : "DÂN LÀNG";
                    const realFactionName = targetPlayer ? targetPlayer.realFaction.toUpperCase() : "DÂN LÀNG";
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ KHAI NHÂN",
                        content: `Hào quang Khai Nhãn xuyên suốt mọi ngụy trang! Vai trò thực của ${playersMap[originalTarget]?.name} là: [${realRoleName}] (Phe ${realFactionName}).`
                    });
                }
            }

            // Pháp Sư Sói (Wolf Mage) soi Tiên tri
            if (act.role === "wolfMage" && act.actionType === "scan_seer") {
                const targetPlayer = playersMap[act.targetId];
                const isSeer = targetPlayer && targetPlayer.role === "seer";
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[👁️‍🗨️] MA PHÁP DÒ ĐƯỜNG",
                    content: `Đối tượng ${targetPlayer?.name} được kiểm tra. Kết quả: ${isSeer ? "LÀ VAI TRÒ TIÊN TRI 🔮" : "KHÔNG PHẢI TIÊN TRI ❌"}.`
                });
            }
        });

        return {
            deaths: Array.from(deathsSet),
            mailboxDeliveries: mailboxDeliveries
        };
    }
};