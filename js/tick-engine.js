import { db, ref, get } from "./firebase-config.js";

export const TickEngine = {
    // PHÂN GIẢI TOÀN BỘ HÀNH ĐỘNG ĐÊM ĐỒNG THỜI (DETERMINISTIC 8-TICK PRIORITY RESOLUTION)
    async resolveNightActions(roomId) {
        const roomRef = ref(db, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        
        if (!snapshot.exists()) {
            return { deaths: [], mailboxDeliveries: {}, playerStateUpdates: {} };
        }

        const roomData = snapshot.val();
        const playersMap = roomData.players || {};
        const playersList = Object.values(playersMap);

        // ==========================================
        // 1. GOM VÀ KHỞI TẠO BỘ LỌC ĐẦU VÀO TRÁNH SAI LỆCH DỮ LIỆU
        // ==========================================
        let actionBuffer = [];
        playersList.forEach(p => {
            if (p.alive && p.targetSelection) {
                actionBuffer.push({
                    srcId: p.id,
                    role: p.role,
                    actionType: p.targetSelection.actionType, 
                    targetId: p.targetSelection.targetId,
                    secondaryId: p.targetSelection.secondaryId || null,
                    phrase: p.targetSelection.phrase || "",
                    isBlocked: false // SỬA BUG 7: Cờ chặn phép chủ động
                });
            }
        });

        // CHỐNG CRASH HỆ THỐNG: Loại bỏ hành động nhắm vào mục tiêu không tồn tại
        actionBuffer = actionBuffer.filter(act => {
            if (act.targetId && !playersMap[act.targetId]) return false;
            if (act.secondaryId && !playersMap[act.secondaryId]) return false;
            return true;
        });

        const deathsSet = new Set();
        const mailboxDeliveries = {}; 
        const playerStateUpdates = {}; 
        
        const initMailbox = (pid) => {
            if (!mailboxDeliveries[pid]) mailboxDeliveries[pid] = [];
        };
        const initPlayerState = (pid) => {
            if (!playerStateUpdates[pid]) playerStateUpdates[pid] = {};
        };

        const purifiedPlayers = new Set();      
        const identitySwaps = {};              
        const trappedPlayers = {};             
        const protectedPlayers = new Set();    
        const primeFollowers = new Set();      
        const mirrorsMap = {};                 
        const silencedPlayers = new Set();     
        const newlyPetroled = new Set();       

        // ==========================================
        // TICK 1: THANH TẨY & GIẢI TRỪ TRẠNG THÁI (ANGEL)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "angel" && act.actionType === "purify") {
                purifiedPlayers.add(act.targetId);
                
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isPetroled = false;

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
        // TICK 2: ĐÁNH TRÁO NHÂN DẠNG, BẺ HƯỚNG & ĐẶT BẪY
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "phantomWolf" && act.actionType === "identity_swap") {
                identitySwaps[act.targetId] = act.secondaryId;
                identitySwaps[act.secondaryId] = act.targetId;
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🎭] TRÁO ĐỔI NHÂN DẠNG",
                    content: `Đã hoàn thành ảo thuật hoán đổi tâm linh giữa: ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name}.`
                });
            }
            if (act.role === "manipulator" && act.actionType === "redirect") {
                actionBuffer.forEach(subAct => {
                    if (subAct.srcId === act.targetId) {
                        subAct.targetId = act.secondaryId; 
                    }
                });
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪄] THAO TÚNG BIÊN DỊCH",
                    content: `Đã bẻ hướng thành công kỹ năng của ${playersMap[act.targetId]?.name} dội sang mục tiêu ${playersMap[act.secondaryId]?.name}.`
                });
            }
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
        // TICK 3: BẢO VỆ & THIẾT LẬP PHẢN CHIẾU
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
            if (act.role === "prime" && act.actionType === "link_followers") {
                primeFollowers.add(act.targetId);
                primeFollowers.add(act.secondaryId);
                
                const primeCovenantChatId = "prime_cov_" + roomId;
                initPlayerState(act.srcId);
                playerStateUpdates[act.srcId].primeCovenantId = primeCovenantChatId;

                [act.targetId, act.secondaryId].forEach(followerId => {
                    initPlayerState(followerId);
                    playerStateUpdates[followerId].primeCovenantId = primeCovenantChatId;
                    playerStateUpdates[followerId].isPrimeFollower = true;
                    initMailbox(followerId);
                    mailboxDeliveries[followerId].push({
                        title: "[🌌] KHẾ ƯỚC TỐI CAO",
                        content: "Bạn đã được lựa chọn làm Thân Cận của Chủ Thần! Được che chở khỏi đòn cắn của Sói và mở kênh Khế Ước."
                    });
                });
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🌌] THIẾT LẬP KHẾ ƯỚC",
                    content: `Khế ước hoàn tất! ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name} đã trở thành Thân Cận.`
                });
            }
            if (act.role === "reflector" && act.actionType === "set_mirror") {
                mirrorsMap[act.targetId] = act.srcId; 
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪞] KÍNH PHẢN QUANG",
                    content: `Thiết lập bảo vệ phản đòn thành công trước cửa nhà của ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // Xử lý phản chiếu mục tiêu phép thuật (Routing)
        const getRoutedTarget = (casterId, currentTargetId, visited = new Set()) => {
            if (!currentTargetId || currentTargetId === "neutralized_by_void") return "neutralized_by_void";
            if (visited.has(currentTargetId)) return "neutralized_by_void"; 
            visited.add(currentTargetId);
            
            if (mirrorsMap[currentTargetId]) {
                const nextTarget = mirrorsMap[currentTargetId];
                if (nextTarget === casterId) return casterId; // Bị dội ngược lại bản thân
                return getRoutedTarget(casterId, nextTarget, visited);
            }
            return currentTargetId;
        };

        actionBuffer.forEach(act => {
            if (act.actionType !== "set_mirror" && act.actionType !== "protect") {
                act.targetId = getRoutedTarget(act.srcId, act.targetId);
                // SỬA BUG 6: Không xóa act khỏi mảng, chỉ làm rỗng targetId để secondaryId vẫn sống sót
            }
        });

        // ==========================================
        // TICK 4: KHÓA PHÉP & CÂM LẶNG (BLOCKS)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "silencerWolf" && act.actionType === "silence") {
                if (!purifiedPlayers.has(act.targetId) && act.targetId !== "neutralized_by_void") {
                    silencedPlayers.add(act.targetId);
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isSilencerMuted = true;
                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🤫] VUỐT TĨNH LẶNG",
                        content: `Bạn đã khóa miệng thành công đối tượng: ${playersMap[act.targetId]?.name}.`
                    });
                }
            }
            if ((act.role === "avenger" && act.actionType === "anesthetize") || (act.role === "cat" && act.actionType === "seal")) {
                if (act.targetId !== "neutralized_by_void") {
                    // SỬA BUG 7: Không xóa khỏi danh sách, chỉ gắn cờ vô hiệu hóa chủ động
                    actionBuffer.forEach(targetAct => {
                        if (targetAct.srcId === act.targetId) targetAct.isBlocked = true;
                    });
                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: `[⚡] KHÓA LUỒNG MA PHÁP`,
                        content: `Đã niêm phong hoàn toàn năng lực phép thuật của ${playersMap[act.targetId]?.name}.`
                    });
                }
            }
        });

        // ==========================================
        // TICK 5: LIÊN KẾT & THU PHỤC ĐỒNG MINH
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.isBlocked) return; // Bỏ qua nếu bị khóa phép

            if (act.role === "cupid" && act.actionType === "link_lovers") {
                const uniqueCoupleId = "couple_" + roomId + "_" + Math.random().toString(36).substring(2, 7);
                [act.targetId, act.secondaryId].forEach(loverId => {
                    if (loverId && loverId !== "neutralized_by_void") {
                        initPlayerState(loverId);
                        playerStateUpdates[loverId].inCouple = true;
                        playerStateUpdates[loverId].coupleId = uniqueCoupleId;
                        initMailbox(loverId);
                        mailboxDeliveries[loverId].push({
                            title: "[💘] MŨI TÊN ÁI TÌNH",
                            content: `Mũi tên vàng của Cupid đã buộc sinh mệnh của bạn vĩnh viễn với người kia!`
                        });
                    }
                });
            }
            if (act.role === "missionary" && act.actionType === "convert" && act.targetId !== "neutralized_by_void") {
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🕍] LỜI KÊU GỌI TỪ THÁNH ĐƯỜNG",
                    content: "Tâm trí bạn đột ngột bị khai sáng bởi Nhà Truyền Giáo! Bạn đã bị thu phục."
                });
            }
            if (act.role === "vampire" && act.actionType === "bite" && act.targetId !== "neutralized_by_void") {
                const vampireChatId = "vampire_" + roomId;
                initPlayerState(act.srcId);
                playerStateUpdates[act.srcId].vampireFactionId = vampireChatId;
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isVampireBitten = true;
                playerStateUpdates[act.targetId].vampireFactionId = vampireChatId;
            }
            if (act.role === "parrot" && act.actionType === "mimic" && act.targetId !== "neutralized_by_void") {
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🦜] LỜI NGUYỀN GHI ÂM",
                    content: `Sáng nay bạn bắt buộc phải thốt ra câu: "${act.phrase}" để giải tỏa bùa chú.`
                });
            }
        });

        // ==========================================
        // TICK 6: SÁT THƯƠNG ĐỒNG THỜI (DAMAGE)
        // ==========================================
        const damageQueue = []; 
        let witchHealTarget = null;
        const witchPoisonTargets = new Set();

        actionBuffer.forEach(act => {
            if (act.isBlocked) return; 
            if (act.role === "witch") {
                if (act.actionType === "heal") witchHealTarget = act.targetId;
                if (act.actionType === "poison" && act.targetId !== "neutralized_by_void") witchPoisonTargets.add(act.targetId);
            }
            if (act.targetId !== "neutralized_by_void") {
                if (act.role === "wolf" || act.actionType === "wolf_bite") damageQueue.push({ targetId: act.targetId, sourceRole: "wolf" });
                if (act.role === "serialKiller" && act.actionType === "serial_kill") damageQueue.push({ targetId: act.targetId, sourceRole: "serialKiller" });
                if (act.role === "avenger" && act.actionType === "execute") damageQueue.push({ targetId: act.targetId, sourceRole: "avenger" });
                if (act.role === "cat" && act.actionType === "tear") damageQueue.push({ targetId: act.targetId, sourceRole: "cat" });
            }
            if (act.role === "arsonist") {
                if (act.actionType === "pour_petrol") {
                    [act.targetId, act.secondaryId].forEach(id => {
                        if (id && id !== "neutralized_by_void") {
                            newlyPetroled.add(id);
                            initPlayerState(id);
                            playerStateUpdates[id].isPetroled = true; 
                        }
                    });
                } else if (act.actionType === "ignite") {
                    playersList.forEach(p => {
                        if (p.isPetroled || newlyPetroled.has(p.id)) {
                            damageQueue.push({ targetId: p.id, sourceRole: "arsonist" });
                        }
                    });
                }
            }
        });

        damageQueue.forEach(dmg => {
            const { sourceRole } = dmg;
            // SỬA BUG 17: Phân giải sát thương phải bị lừa bởi Sói Ảo Ảnh
            const targetId = identitySwaps[dmg.targetId] || dmg.targetId;

            if (targetId === witchHealTarget) return;
            if (protectedPlayers.has(targetId) && sourceRole !== "arsonist") return;
            if (primeFollowers.has(targetId) && sourceRole === "wolf") return;

            deathsSet.add(targetId);
        });

        witchPoisonTargets.forEach(targetId => {
            deathsSet.add(targetId);
            initMailbox(targetId);
            mailboxDeliveries[targetId].push({
                title: "[☠️] BẢN ÁN TỬ PHÙ THỦY",
                content: "Bình độc dược cực mạnh của Phù Thủy dội xuống tước đi sinh mạng bạn!"
            });
        });

        // ==========================================
        // TICK 7: PHẢN SÁT & TRẢ ĐÒN CUỐI CÙNG
        // ==========================================
        actionBuffer.forEach(act => {
            // SỬA BUG 7: Thợ Săn chết được quyền bắn bất chấp isBlocked = true
            if (act.role === "hunter" && deathsSet.has(act.srcId)) {
                // SỬA BUG 15: Đạn của Thợ Săn phải chịu ảnh hưởng của Gương Phản Chiếu
                const routedHunterTarget = getRoutedTarget(act.srcId, act.targetId);
                
                if (routedHunterTarget && routedHunterTarget !== "neutralized_by_void") {
                    deathsSet.add(routedHunterTarget);
                    initMailbox(routedHunterTarget);
                    mailboxDeliveries[routedHunterTarget].push({
                        title: "[🏹] PHÁT BẮN TIỄN BIỆT",
                        content: `Thợ Săn đã ngã xuống dính sát thương, nhưng phát đạn ghim trả đũa kịp kéo bạn chết cùng!`
                    });
                }
            }

            if (trappedPlayers[act.srcId] && !act.isBlocked) {
                const trapTargets = trappedPlayers[act.srcId];
                actionBuffer.forEach(subAct => {
                    if (trapTargets.includes(subAct.srcId) && subAct.targetId === act.srcId && !subAct.isBlocked) {
                        deathsSet.add(subAct.srcId);
                        initMailbox(subAct.srcId);
                        mailboxDeliveries[subAct.srcId].push({
                            title: "[⚔️] SẬP BẪY SẮT THANH TRỪNG",
                            content: "Bạn vừa dại dột thi triển kỹ năng lên Kẻ Thanh Trừng! Bẫy thép kẹp cơ thể bạn dính đòn nặng!"
                        });
                    }
                });
            }
        });

        // ==========================================
        // TICK 8: TRUY XUẤT THÔNG TIN BẢO MẬT (SEER)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.isBlocked || act.targetId === "neutralized_by_void") return;

            if (act.role === "seer" && (act.actionType === "seer_scan" || act.actionType === "seer_open_eye")) {
                const finalTargetId = identitySwaps[act.targetId] || act.targetId;
                const targetPlayer = playersMap[finalTargetId];

                initMailbox(act.srcId);
                if (act.actionType === "seer_scan") {
                    let factionResult = "🌾 PHE DÂN LÀNG 🌾";
                    if (targetPlayer && targetPlayer.realFaction === "wolf") factionResult = "🐺 PHE MA SÓI 🐺";
                    else if (targetPlayer && targetPlayer.realFaction === "third") factionResult = "🧛 PHE THỨ BA 🧛";
                    
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ THẤU THỊ",
                        content: `Linh hồn của ${playersMap[act.targetId]?.name} thuộc về: ${factionResult}.`
                    });
                } else {
                    const realRoleName = targetPlayer ? targetPlayer.role.toUpperCase() : "DÂN LÀNG";
                    const realFactionName = targetPlayer ? targetPlayer.realFaction.toUpperCase() : "DÂN LÀNG";
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ KHAI NHÃN",
                        content: `Vai trò thực của ${playersMap[act.targetId]?.name} là: [${realRoleName}] (Phe ${realFactionName}).`
                    });
                }
            }

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

        // Kênh chat Tử Thần
        const reaperFactionChatId = "reaper_" + roomId;
        const reapers = playersList.filter(p => p.alive && (p.role === "reaper" || p.role === "apprenticeReaper"));
        if (reapers.length >= 2) {
            reapers.forEach(r => {
                initPlayerState(r.id);
                playerStateUpdates[r.id].reaperFactionId = reaperFactionChatId;
            });
        }

        return {
            deaths: Array.from(deathsSet),
            mailboxDeliveries: mailboxDeliveries,
            playerStateUpdates: playerStateUpdates
        };
    }
};