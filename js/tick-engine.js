import { db, ref, get } from "./firebase-config.js";
import { ROLE_DB } from "./game-logic.js";

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

        // Khởi tạo cấu trúc dữ liệu trả về và ghi đè
        const deathsSet = new Set();
        const mailboxDeliveries = {}; 
        const playerStateUpdates = {}; 
        
        const initMailbox = (pid) => {
            if (!mailboxDeliveries[pid]) mailboxDeliveries[pid] = [];
        };

        const initPlayerState = (pid) => {
            if (!playerStateUpdates[pid]) playerStateUpdates[pid] = {};
        };

        // ==========================================
        // SỬA LỖI BUFF/DEBUFF PERSISTENCE (BUG 5)
        // Reset sạch bùa chú tạm thời của đêm hôm trước để tránh bị lưu dính vĩnh viễn
        // ==========================================
        playersList.forEach(p => {
            initPlayerState(p.id);
            playerStateUpdates[p.id].isSeerScanned = false;
            playerStateUpdates[p.id].isProtected = false;
            playerStateUpdates[p.id].isGuardBlocked = false;
            playerStateUpdates[p.id].isWitchHealed = false;
            playerStateUpdates[p.id].isWitchPoisoned = false;
            playerStateUpdates[p.id].isHunterMarked = false;
            playerStateUpdates[p.id].isAngelPurified = false;
            playerStateUpdates[p.id].isCarverBlacklisted = false;
            playerStateUpdates[p.id].isGuarantorSealed = false;
            playerStateUpdates[p.id].isReflectorMirrored = false;
            playerStateUpdates[p.id].isAvengerAsleep = false;
            playerStateUpdates[p.id].isAvengerExecuted = false;
            playerStateUpdates[p.id].isWolfTargeted = false;
            playerStateUpdates[p.id].isSnowWolfFrozen = false;
            playerStateUpdates[p.id].isWolfMageScanned = false;
            playerStateUpdates[p.id].isPhantomSwapped = false;
            playerStateUpdates[p.id].isSilencerMuted = false;
            playerStateUpdates[p.id].isSolitaireCursed = false;
            playerStateUpdates[p.id].isDemonHellfire = false;
            playerStateUpdates[p.id].isMissionaryConverted = false;
            playerStateUpdates[p.id].isVampireBitten = false;
            playerStateUpdates[p.id].isArsonistIgnited = false;
            playerStateUpdates[p.id].isEradicatorTrapped = false;
            playerStateUpdates[p.id].isManipulatorManipulated = false;
            playerStateUpdates[p.id].isLethalSlashed = false;
            playerStateUpdates[p.id].isReaperPredicted = false;
            playerStateUpdates[p.id].isCatClawed = false;
            playerStateUpdates[p.id].isCatSealed = false;
            playerStateUpdates[p.id].isReaperCorpse = false;
        });

        // Thu thập hành động thô ban đầu
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

        // Lọc bỏ các hành động nhắm vào mục tiêu không tồn tại
        actionBuffer = actionBuffer.filter(act => {
            if (act.targetId && !playersMap[act.targetId]) return false;
            if (act.secondaryId && !playersMap[act.secondaryId]) return false;
            return true;
        });

        // Khai báo tập hợp cấu trúc định tuyến
        const purifiedPlayers = new Set();      
        const identitySwaps = {};              
        const trappedPlayers = {};             
        const protectedPlayers = new Set();    
        const primeFollowers = new Set();      
        const mirrorsMap = {};                 
        const blockedCasters = new Set();      
        const silencedPlayers = new Set();     
        const convertedPlayers = new Set();    
        const vampireBittenPlayers = new Set(); 
        const newlyPetroled = new Set();       

        // ==========================================
        // TICK 1: THANH TẨY & GIẢI TRỪ TRẠNG THÁI (ANGEL PURIFICATION)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "angel" && act.actionType === "purify") {
                purifiedPlayers.add(act.targetId);
                
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isPetroled = false;
                playerStateUpdates[act.targetId].isAngelPurified = true;

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
        // 2.1 Sói Ảo Ảnh (Phantom Wolf) hoán đổi
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
        });

        // SỬA LỖI SÓI ẢO ẢNH CHỈ LỪA ĐƯỢC TIÊN TRI (BUG 17)
        // Áp dụng định hướng tráo đổi thực tế lên toàn bộ các hành động ngay sau khi hoán đổi hoàn tất
        actionBuffer.forEach(act => {
            if (act.role !== "phantomWolf") {
                if (identitySwaps[act.targetId]) {
                    act.targetId = identitySwaps[act.targetId];
                    initPlayerState(act.srcId);
                    playerStateUpdates[act.srcId].isPhantomSwapped = true;
                }
                if (act.secondaryId && identitySwaps[act.secondaryId]) {
                    act.secondaryId = identitySwaps[act.secondaryId];
                }
            }
        });

        // 2.2 Kẻ Thao Túng (The Manipulator) điều hướng kỹ năng
        actionBuffer.forEach(act => {
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
        actionBuffer.forEach(act => {
            if (act.role === "guard" && act.actionType === "protect") {
                protectedPlayers.add(act.targetId);
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isProtected = true;

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
                        content: "Bạn đã được lựa chọn làm Thân Cận của Chủ Thần tối cao! Bạn được che chở bảo vệ và được mở kênh thảo luận đêm Khế Ước."
                    });
                });

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🌌] THIẾT LẬP KHẾ ƯỚC CHỦ THẦN",
                    content: `Khế ước linh hồn hoàn tất! Thần dân ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name} đã chính thức trở thành Thân Cận đêm nay.`
                });
            }
        });

        // Thiết lập Kẻ Phản Chiếu (The Reflector)
        actionBuffer.forEach(act => {
            if (act.role === "reflector" && act.actionType === "set_mirror") {
                mirrorsMap[act.targetId] = act.srcId; 
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isReflectorMirrored = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪞] KÍNH PHẢN QUANG ĐÃ DỰNG",
                    content: `Thiết lập bảo vệ phản đòn thành công trước cửa nhà của ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // Hàm dò vết bẻ tuyến phản chiếu (Gìn giữ mục tiêu secondaryId - Sửa lỗi Bug 6)
        const getRoutedTarget = (casterId, currentTargetId, visited = new Set()) => {
            if (!currentTargetId || currentTargetId === "neutralized_by_void") return "neutralized_by_void";
            if (visited.has(currentTargetId)) return "neutralized_by_void"; 
            visited.add(currentTargetId);
            
            if (mirrorsMap[currentTargetId]) {
                const nextTarget = mirrorsMap[currentTargetId];
                if (nextTarget === casterId) {
                    return casterId; 
                }
                return getRoutedTarget(casterId, nextTarget, visited);
            }
            return currentTargetId;
        };

        // Bẻ hướng toàn bộ hành động qua gương phản chiếu
        actionBuffer.forEach(act => {
            if (act.actionType !== "set_mirror" && act.actionType !== "protect") {
                act.targetId = getRoutedTarget(act.srcId, act.targetId);
            }
        });

        // ==========================================
        // TICK 4: KHÓA PHÉP & CÂM LẶNG (BLOCKS & SILENCE)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "silencerWolf" && act.actionType === "silence") {
                if (!purifiedPlayers.has(act.targetId)) {
                    silencedPlayers.add(act.targetId);
                    
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isSilencerMuted = true; 

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🤫] VUỐT TĨNH LẶNG",
                        content: `Bạn đã khóa miệng thành công đối tượng: ${playersMap[act.targetId]?.name} cho ngày mai.`
                    });
                    initMailbox(act.targetId);
                    mailboxDeliveries[act.targetId].push({
                        title: "[🤫] KHÓA BIỆN HỘ BĂNG KHÍ",
                        content: "Cổ họng bạn bị đông cứng bởi luồng vuốt băng khí của Sói Câm Lặng! Sáng nay bạn không thể phát ngôn thảo luận."
                    });
                }
            }
            if ((act.role === "avenger" && act.actionType === "anesthetize") || (act.role === "cat" && act.actionType === "seal")) {
                blockedCasters.add(act.targetId);
                
                initPlayerState(act.targetId);
                if (act.role === "avenger") playerStateUpdates[act.targetId].isAvengerAsleep = true;
                if (act.role === "cat") playerStateUpdates[act.targetId].isCatSealed = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: `[⚡] KHÓA LUỒNG MA PHÁP`,
                    content: `Đã niêm phong hoàn toàn năng lực phép thuật của ${playersMap[act.targetId]?.name} thành công.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💤] TRẠNG THÁI PHONG ẤN / GÂY MÊ",
                    content: "Kỹ năng đêm nay của bạn bị phong tỏa vô hiệu! Bạn buộc phải ngủ say qua lượt này."
                });
            }
        });

        // Loại bỏ các lệnh hành động từ những Caster đã dính trạng thái khóa phép
        actionBuffer = actionBuffer.filter(act => !blockedCasters.has(act.srcId));

        // ==========================================
        // TICK 5: LIÊN KẾT & THU PHỤC ĐỒNG MINH (ALIGNMENT SHIFT & LINKS)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "cupid" && act.actionType === "link_lovers") {
                const uniqueCoupleId = "couple_" + roomId + "_" + Math.random().toString(36).substring(2, 7);

                [act.targetId, act.secondaryId].forEach(loverId => {
                    initPlayerState(loverId);
                    playerStateUpdates[loverId].inCouple = true;
                    playerStateUpdates[loverId].coupleId = uniqueCoupleId;
                    playerStateUpdates[loverId].isCupidLinked = true;
                });

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

            if (act.role === "missionary" && act.actionType === "convert") {
                convertedPlayers.add(act.targetId);
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isMissionaryConverted = true;

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

            if (act.role === "vampire" && act.actionType === "bite") {
                vampireBittenPlayers.add(act.targetId);
                const vampireChatId = "vampire_" + roomId;

                initPlayerState(act.srcId);
                playerStateUpdates[act.srcId].vampireFactionId = vampireChatId;

                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isVampireBitten = true;
                playerStateUpdates[act.targetId].vampireFactionId = vampireChatId;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🧛] HUYẾT LỆNH ĐÊM ĐEN",
                    content: `Vết nanh vuốt bóng đêm đã được ghi nhận trên cơ thể của ${playersMap[act.targetId]?.name}.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🩸] VẾT CẮN BÓNG ĐÊM",
                    content: "Đêm qua một Vampire đã ghé thăm phòng ngủ của bạn và để lại vết cắn nguyền rủa râm ran đau nhức! Bạn đã được kết nối vào kênh chat Huyết Tộc."
                });
            }

            if (act.role === "parrot" && act.actionType === "mimic") {
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🦜] LỜI NGUYỀN SAO CHÉP",
                    content: `Đã ép buộc ${playersMap[act.targetId]?.name} phải lặp lại câu thoại: '${act.phrase}' vào sáng mai.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🦜] LỜI NGUYỀN GHI ÂM",
                    content: `Cổ họng bạn bị điều khiển bởi bùa chú của Vẹt! Sáng nay bạn bắt buộc phải thốt ra câu: "${act.phrase}" để giải tỏa bùa chú.`
                });
            }
        });

        // ==========================================
        // TICK 6: SÁT THƯƠNG ĐỒNG THỜI (DAMAGE RESOLUTION)
        // ==========================================
        const damageQueue = []; 
        let witchHealTarget = null;
        const witchPoisonTargets = new Set();

        actionBuffer.forEach(act => {
            if (act.role === "witch") {
                if (act.actionType === "heal") {
                    witchHealTarget = act.targetId;
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isWitchHealed = true;
                }
                if (act.actionType === "poison") {
                    witchPoisonTargets.add(act.targetId);
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isWitchPoisoned = true;
                }
            }
        });

        actionBuffer.forEach(act => {
            if (act.role === "wolf" || act.actionType === "wolf_bite") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "wolf" });
            }
            if (act.role === "serialKiller" && act.actionType === "serial_kill") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "serialKiller" });
            }
            if (act.role === "avenger" && act.actionType === "execute") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "avenger" });
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isAvengerExecuted = true;
            }
            if (act.role === "cat" && act.actionType === "tear") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "cat" });
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isCatClawed = true;
            }
        });

        actionBuffer.forEach(act => {
            if (act.role === "arsonist") {
                if (act.actionType === "pour_petrol") {
                    newlyPetroled.add(act.targetId);
                    if (act.secondaryId) newlyPetroled.add(act.secondaryId);

                    [act.targetId, act.secondaryId].filter(id => id !== null).forEach(id => {
                        initPlayerState(id);
                        playerStateUpdates[id].isPetroled = true; 
                        playerStateUpdates[id].isArsonistPetroled = true;
                    });
                } else if (act.actionType === "ignite") {
                    playersList.forEach(p => {
                        if (p.isPetroled || newlyPetroled.has(p.id)) {
                            damageQueue.push({ targetId: p.id, sourceRole: "arsonist" });
                            initPlayerState(p.id);
                            playerStateUpdates[p.id].isArsonistIgnited = true;
                        }
                    });
                }
            }
        });

        damageQueue.forEach(dmg => {
            const { targetId, sourceRole } = dmg;

            if (targetId === witchHealTarget) return;

            if (protectedPlayers.has(targetId) && sourceRole !== "arsonist") {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🛡️] THƯ CỨU NẠN BÓNG ĐÊM",
                    content: "Đêm qua nanh vuốt bóng đêm đã tìm đến phòng ngủ bạn, nhưng lá chắn Bảo Vệ đã che chở thành công!"
                });
                return;
            }

            if (primeFollowers.has(targetId) && sourceRole === "wolf") {
                return;
            }

            deathsSet.add(targetId);
        });

        witchPoisonTargets.forEach(targetId => {
            deathsSet.add(targetId);
            initMailbox(targetId);
            mailboxDeliveries[targetId].push({
                title: "[☠️] BẢN ÁN TỬ PHÙ THỦY",
                content: "Một cơn đau thắt tim dữ dội xảy ra. Bình độc dược cực mạnh của Phù Thủy dội xuống tước đi sinh mạng bạn!"
            });
        });

        // ==========================================
        // TICK 7: PHẢN SÁT & TRẢ ĐÒN CUỐI CÙNG (DEATH RETALIATIONS)
        // ==========================================
        // SỬA LỖI THỢ SĂN BỊ KHÓA PHÉP NHƯNG VẪN BẮN (BUG 7) & BÚA PHẢN CHIẾU VS THỢ SĂN (BUG 15)
        // Quét độc lập trực tiếp từ cấu trúc người chơi gốc để đảm bảo phát súng tử vong luôn nổ súng
        playersList.forEach(p => {
            if (p.role === "hunter" && deathsSet.has(p.id) && p.targetSelection) {
                let hunterTarget = p.targetSelection.targetId;
                
                // Liên kết phát bắn của Thợ Săn xuyên qua tuyến gương phản chiếu
                hunterTarget = getRoutedTarget(p.id, hunterTarget);

                if (hunterTarget && hunterTarget !== "neutralized_by_void" && playersMap[hunterTarget] && playersMap[hunterTarget].alive) {
                    deathsSet.add(hunterTarget);
                    
                    initPlayerState(p.id);
                    playerStateUpdates[p.id].isHunterMarked = true;

                    initMailbox(hunterTarget);
                    mailboxDeliveries[hunterTarget].push({
                        title: "[🏹] PHÁT BẮN TIỄN BIỆT",
                        content: `Thợ Săn [${p.name}] đã ngã xuống trong đêm, phát đạn ghim trả đũa của họ đã xuyên tim gạt phao sinh mệnh bạn!`
                    });
                }
            }
        });

        // Sập bẫy của Kẻ Thanh Trừng (Eradicator) đặt phòng vệ
        actionBuffer.forEach(act => {
            if (trappedPlayers[act.srcId]) {
                const trapTargets = trappedPlayers[act.srcId];
                actionBuffer.forEach(subAct => {
                    if (trapTargets.includes(subAct.srcId) && subAct.targetId === act.srcId) {
                        deathsSet.add(subAct.srcId);
                        initPlayerState(act.srcId);
                        playerStateUpdates[act.srcId].isEradicatorTrapped = true;

                        initMailbox(subAct.srcId);
                        mailboxDeliveries[subAct.srcId].push({
                            title: "[⚔️] SẬP BẪY SẮT THANH TRỪNG",
                            content: "Bạn vừa dại dột thi triển kỹ năng lên Kẻ Thanh Trừng! Bẫy thép kẹp cơ thể bạn dính đòn trực diện cực nặng!"
                        });
                    }
                });
            }
        });

        // ==========================================
        // TICK 8: TRUY XUẤT THÔNG TIN BẢO MẬT (SEER & WOLF MAGE RESOLUTIONS)
        // ==========================================
        actionBuffer.forEach(act => {
            if (act.role === "seer" && (act.actionType === "seer_scan" || act.actionType === "seer_open_eye")) {
                const originalTarget = act.targetId;
                const finalTargetId = identitySwaps[originalTarget] || originalTarget;
                const targetPlayer = playersMap[finalTargetId];

                initMailbox(act.srcId);
                initPlayerState(originalTarget);
                playerStateUpdates[originalTarget].isSeerScanned = true;
                
                if (act.actionType === "seer_scan") {
                    let factionResult = "🌾 PHE DÂN LÀNG 🌾";
                    if (targetPlayer && targetPlayer.realFaction === "wolf") {
                        factionResult = "🐺 PHE MA SÓI 🐺";
                    } else if (targetPlayer && targetPlayer.realFaction === "third") {
                        factionResult = "🧛 PHE THỨ BA 🧛";
                    }
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ THẤU THỊ",
                        content: `Phép thuật thấu thị hoàn tất! Linh hồn của ${playersMap[originalTarget]?.name} thuộc về: ${factionResult}.`
                    });
                } else {
                    const realRoleName = targetPlayer ? targetPlayer.role.toUpperCase() : "DÂN LÀNG";
                    const realFactionName = targetPlayer ? targetPlayer.realFaction.toUpperCase() : "DÂN LÀNG";
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ KHAI NHÃN",
                        content: `Hào quang Khai Nhãn rọi thấu ngụy trang! Vai trò thực của ${playersMap[originalTarget]?.name} là: [${realRoleName}] (Phe ${realFactionName}).`
                    });
                }
            }

            if (act.role === "wolfMage" && act.actionType === "scan_seer") {
                const targetPlayer = playersMap[act.targetId];
                const isSeer = targetPlayer && targetPlayer.role === "seer";
                
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isWolfMageScanned = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[👁️‍🗨️] MA PHÁP DÒ ĐƯỜNG",
                    content: `Đối tượng ${targetPlayer?.name} được kiểm tra. Kết quả: ${isSeer ? "LÀ VAI TRÒ TIÊN TRI 🔮" : "KHÔNG PHẢI TIÊN TRI ❌"}.`
                });
            }
        });

        // Thiết lập động kênh chat Tử Thần (Reaper Faction chat)
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