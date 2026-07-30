/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - DETERMINISTIC 8-TICK RESOLUTION ENGINE (UPDATE 8 FULL)
 * =========================================================================
 * Bộ máy phân giải kỹ năng ban đêm theo thứ tự ưu tiên 8 Ticks (Priority Order).
 * Giải quyết toàn bộ hiệu ứng phản xạ gương, bẫy sắt, chuyển hóa, tịnh hóa,
 * lá chắn bảo vệ, độc dược, gom phiếu Sói cắn và di ngôn nổ súng tử vong.
 */

import { db, ref, get } from "./firebase-config.js";

export const TickEngine = {
    /**
     * PHÂN GIẢI TOÀN BỘ HÀNH ĐỘNG ĐÊM ĐỒNG THỜI (8-TICK PRIORITY RESOLUTION)
     * @param {string} roomId - Mã phòng chơi 6 ký tự
     * @returns {Promise<{deaths: Array<string>, mailboxDeliveries: Object, playerStateUpdates: Object}>}
     */
    async resolveNightActions(roomId) {
        const roomRef = ref(db, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        
        if (!snapshot.exists()) {
            return { deaths: [], mailboxDeliveries: {}, playerStateUpdates: {} };
        }

        const roomData = snapshot.val();
        const playersMap = roomData.players || {};
        const playersList = Object.values(playersMap);
        const currentDay = roomData.meta?.day || 1;

        // Tập dữ liệu ghi nhận sau phân giải
        const deathsSet = new Set();
        const mailboxDeliveries = {}; 
        const playerStateUpdates = {}; 
        
        const initMailbox = (pid) => {
            if (!mailboxDeliveries[pid]) mailboxDeliveries[pid] = [];
        };

        const initPlayerState = (pid) => {
            if (!playerStateUpdates[pid]) playerStateUpdates[pid] = {};
        };

        // BẢN ĐỒ BỘ NHỚ TẠM QUẢN LÝ TẮM XĂNG TỪ CÁC ĐÊM TRƯỚC (Khắc phục lỗi Arsonist same-night burn)
        const alreadyPetroled = new Set();
        playersList.forEach(p => {
            if (p.isPetroled || p.isArsonistPetroled) {
                alreadyPetroled.add(p.id);
            }
        });

        // RESET BÙA CHÚ TẠM THỜI CỦA ĐÊM TRƯỚC (Tránh dính bùa vĩnh viễn)
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

        // Thu thập toàn bộ hành động đêm từ người chơi CÒN SỐNG VÀ ĐANG ONLINE
        let actionBuffer = [];
        playersList.forEach(p => {
            if (p.alive && p.isConnected !== false && p.targetSelection) {
                actionBuffer.push({
                    srcId: p.id,
                    role: p.role,
                    actionType: p.targetSelection.actionType, 
                    targetId: p.targetSelection.targetId || null,
                    secondaryId: p.targetSelection.secondaryId || null,
                    phrase: p.targetSelection.phrase || ""
                });
            }
        });

        // Lọc bỏ hành động nhắm vào ID không tồn tại
        actionBuffer = actionBuffer.filter(act => {
            if (act.targetId && !playersMap[act.targetId]) return false;
            if (act.secondaryId && !playersMap[act.secondaryId]) return false;
            return true;
        });

        // Cấu trúc theo dõi trạng thái tương tác
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
        const frozenPlayers = new Set();

        // ==========================================
        // TICK 1: THANH TẨY, KẾ THỪA VÀ BIẾN ĐỔI BAN ĐẦU
        // ==========================================
        
        // 1.1 Thiên Sứ (Angel) Tịnh Hóa
        actionBuffer.forEach(act => {
            if (act.role === "angel" && (act.actionType === "purify" || act.actionType === "angel_purify")) {
                if (act.targetId) {
                    purifiedPlayers.add(act.targetId);
                    alreadyPetroled.delete(act.targetId);

                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isPetroled = false;
                    playerStateUpdates[act.targetId].isArsonistPetroled = false;
                    playerStateUpdates[act.targetId].isAngelPurified = true;
                    playerStateUpdates[act.targetId].isSilencerMuted = false;

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
            }
        });

        // 1.2 Kế thừa Tiên Tri Tập Sự (Apprentice Seer)
        const activeSeers = playersList.filter(p => p.role === "seer" && p.alive);
        if (activeSeers.length === 0) {
            playersList.forEach(p => {
                if (p.role === "apprenticeSeer" && p.alive) {
                    initPlayerState(p.id);
                    playerStateUpdates[p.id].role = "seer";
                    initMailbox(p.id);
                    mailboxDeliveries[p.id].push({
                        title: "[🔮] KẾ THỪA THẦN LỰC",
                        content: "Tiên Tri vương quốc đã hy sinh! Bạn chính thức kế thừa quả cầu tinh tú và trở thành TIÊN TRI mới.",
                        category: "system"
                    });
                }
            });
        }

        // 1.3 Kế thừa Tử Thần Tập Sự (Apprentice Reaper)
        const activeReapers = playersList.filter(p => p.role === "reaper" && p.alive);
        if (activeReapers.length === 0) {
            playersList.forEach(p => {
                if (p.role === "apprenticeReaper" && p.alive) {
                    initPlayerState(p.id);
                    playerStateUpdates[p.id].role = "reaper";
                    initMailbox(p.id);
                    mailboxDeliveries[p.id].push({
                        title: "[💀] KẾ THỪA LƯỠI HÁI TỬ THẦN",
                        content: "Tử Thần tiền nhiệm đã ngã xuống! Bạn chính thức nắm giữ chiếc Lưỡi Hái Tối Cao.",
                        category: "system"
                    });
                }
            });
        }

        // 1.4 Song Trùng (Doppelganger) Kế Thừa Trực Tiếp
        actionBuffer.forEach(act => {
            if (act.role === "doppelganger" && act.actionType === "copy_role" && act.targetId) {
                const targetPlayer = playersMap[act.targetId];
                if (targetPlayer && !targetPlayer.alive) {
                    initPlayerState(act.srcId);
                    playerStateUpdates[act.srcId].role = targetPlayer.role;
                    playerStateUpdates[act.srcId].realFaction = targetPlayer.realFaction;
                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🎭] SONG TRÙNG BIẾN HÌNH",
                        content: `Đối tượng [${targetPlayer.name}] đã tử vong! Bạn kế thừa vai trò [${targetPlayer.role.toUpperCase()}] của họ.`
                    });
                }
            }
        });

        // 1.5 Kẻ Phản Bội (Traitor) Thức Tỉnh Khi Bầy Sói Chết Hết
        const activeWolves = playersList.filter(p => p.alive && p.realFaction === "wolf" && p.role !== "traitor");
        if (activeWolves.length === 0) {
            playersList.forEach(p => {
                if (p.role === "traitor" && p.alive) {
                    initPlayerState(p.id);
                    playerStateUpdates[p.id].role = "wolfBoss";
                    playerStateUpdates[p.id].realFaction = "wolf";
                    initMailbox(p.id);
                    mailboxDeliveries[p.id].push({
                        title: "[🐺] SỰ THỨC TỈNH CỦA KẺ PHẢN BỘI",
                        content: "Toàn bộ đồng bọn Ma Sói đã bị tiêu diệt! Bạn chính thức thức tỉnh bản năng Ma Sói và trở thành SÓI TRÙM mới.",
                        category: "system"
                    });
                }
            });
        }

        // ==========================================
        // TICK 2: TRÁO ĐỔI VAI TRÒ, HOÁN ĐỔI NHÂN DẠNG VÀ BẮT BẪY
        // ==========================================
        
        // 2.1 Tên Trộm (Thief) Đổi Bài Đêm 1
        actionBuffer.forEach(act => {
            if (act.role === "thief" && act.actionType === "swap_role" && currentDay === 1 && act.targetId) {
                const targetPlayer = playersMap[act.targetId];
                if (targetPlayer && targetPlayer.alive) {
                    initPlayerState(act.srcId);
                    initPlayerState(act.targetId);

                    const tempRole = targetPlayer.role;
                    const tempFaction = targetPlayer.realFaction;

                    playerStateUpdates[act.srcId].role = tempRole;
                    playerStateUpdates[act.srcId].realFaction = tempFaction;

                    playerStateUpdates[act.targetId].role = "villager";
                    playerStateUpdates[act.targetId].realFaction = "villager";

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🦹] TRỘM VAI TRÒ THÀNH CÔNG",
                        content: `Bạn đã ăn trộm vai trò của [${targetPlayer.name}]. Vai trò mới của bạn là: [${tempRole.toUpperCase()}].`
                    });

                    initMailbox(act.targetId);
                    mailboxDeliveries[act.targetId].push({
                        title: "[🦹] BỊ TRỘM VAI TRÒ",
                        content: "Tên Trộm đã ghé thăm nhà bạn đêm qua và cuống phăng vai trò của bạn! Bạn trở thành DÂN LÀNG."
                    });
                }
            }
        });

        // 2.2 Sói Ảo Ảnh (Phantom Wolf) Hoán Đổi Nhân Dạng
        actionBuffer.forEach(act => {
            if (act.role === "phantomWolf" && act.actionType === "identity_swap" && act.targetId && act.secondaryId) {
                identitySwaps[act.targetId] = act.secondaryId;
                identitySwaps[act.secondaryId] = act.targetId;
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🎭] TRÁO ĐỔI NHÂN DẠNG",
                    content: `Đã hoàn thành ảo thuật hoán đổi tâm linh giữa: ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name}.`
                });
            }
        });

        // Áp dụng tráo đổi nhân dạng lên CẢ targetId VÀ secondaryId của các kỹ năng khác
        actionBuffer.forEach(act => {
            if (act.role !== "phantomWolf") {
                if (act.targetId && identitySwaps[act.targetId]) {
                    act.targetId = identitySwaps[act.targetId];
                    initPlayerState(act.srcId);
                    playerStateUpdates[act.srcId].isPhantomSwapped = true;
                }
                if (act.secondaryId && identitySwaps[act.secondaryId]) {
                    act.secondaryId = identitySwaps[act.secondaryId];
                }
            }
        });

        // 2.3 Kẻ Thao Túng (Manipulator) Bẻ Hướng Kỹ Năng
        actionBuffer.forEach(act => {
            if (act.role === "manipulator" && act.actionType === "redirect" && act.targetId && act.secondaryId) {
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

        // 2.4 Kẻ Thanh Trừng (Eradicator) Đặt Bẫy Thép
        actionBuffer.forEach(act => {
            if (act.role === "eradicator" && act.actionType === "set_trap" && act.targetId) {
                trappedPlayers[act.srcId] = [act.targetId, act.secondaryId].filter(id => id !== null);
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[⚔️] PHÒNG THỦ THANH TRỪNG",
                    content: `Đã thiết lập bẫy phòng thủ giám sát mục tiêu.`
                });
            }
        });

        // ==========================================
        // TICK 3: BẢO VỆ, LÁ CHẮN, KHẾ ƯỚC VÀ GƯƠNG PHẢN CHIẾU
        // ==========================================
        
        // 3.1 Bảo Vệ (Guard) Tuần Tra
        actionBuffer.forEach(act => {
            if (act.role === "guard" && act.actionType === "protect" && act.targetId) {
                protectedPlayers.add(act.targetId);
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isProtected = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🛡️] NHẬT KÝ TUẦN TRA",
                    content: `Lá chắn Bảo Vệ đã dựng lên an toàn xung quanh nhà của ${playersMap[act.targetId]?.name}.`
                });
            }

            // 3.2 Chủ Thần (Prime) Lập Khế Ước
            if (act.role === "prime" && act.actionType === "link_followers" && act.targetId && act.secondaryId) {
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
                        content: "Bạn đã được lựa chọn làm Thân Cận của Chủ Thần! Bạn nhận được sự che chở đêm nay và kết nối kênh chat Khế Ước."
                    });
                });

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🌌] KHẾ ƯỚC BẤT DIỆT",
                    content: `Đã kết nối linh hồn của ${playersMap[act.targetId]?.name} và ${playersMap[act.secondaryId]?.name} vào Khế Ước.`
                });
            }

            // 3.3 Sói Tuyết (Snow Wolf) Đóng Băng Mục Tiêu
            if (act.role === "wolfSnow" && act.actionType === "freeze" && act.targetId) {
                frozenPlayers.add(act.targetId);
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isSnowWolfFrozen = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[❄️] BĂNG KHÍ TỘỘC SÓI",
                    content: `Bạn đã đóng băng cứng đối tượng ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // 3.4 Kẻ Phản Chiếu (Reflector) & Sói Gương (Mirror Wolf) Dựng Kính
        actionBuffer.forEach(act => {
            if ((act.role === "reflector" || act.role === "mirrorWolf") && act.actionType === "set_mirror" && act.targetId) {
                mirrorsMap[act.targetId] = act.srcId; 
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isReflectorMirrored = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪞] KÍNH PHẢN QUANG",
                    content: `Đã dựng kính phản chiếu ma thuật dội ngược kỹ năng trước cửa nhà ${playersMap[act.targetId]?.name}.`
                });
            }
        });

        // Hàm dò vết bẻ tuyến phản chiếu qua gương
        const getRoutedTarget = (casterId, currentTargetId, visited = new Set()) => {
            if (!currentTargetId || currentTargetId === "neutralized") return "neutralized";
            if (visited.has(currentTargetId)) return "neutralized"; 
            visited.add(currentTargetId);
            
            if (mirrorsMap[currentTargetId]) {
                const nextTarget = mirrorsMap[currentTargetId];
                if (nextTarget === casterId) return casterId; 
                return getRoutedTarget(casterId, nextTarget, visited);
            }
            return currentTargetId;
        };

        // Bẻ hướng toàn bộ hành động qua gương phản chiếu (TRỪ BẢO VỆ "protect")
        actionBuffer.forEach(act => {
            if (act.actionType !== "set_mirror" && act.actionType !== "protect" && act.targetId) {
                act.targetId = getRoutedTarget(act.srcId, act.targetId);
            }
        });

        // ==========================================
        // TICK 4: KHÓA PHÉP, PHONG ẤN VÀ CÂM LẶNG
        // ==========================================
        actionBuffer.forEach(act => {
            // Sói Câm Lặng (Silencer Wolf)
            if (act.role === "silencerWolf" && act.actionType === "silence" && act.targetId) {
                if (!purifiedPlayers.has(act.targetId)) {
                    silencedPlayers.add(act.targetId);
                    
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isSilencerMuted = true; 

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🤫] VUỐT TĨNH LẶNG",
                        content: `Đã khóa miệng đối tượng ${playersMap[act.targetId]?.name} cho ngày mai.`
                    });
                    initMailbox(act.targetId);
                    mailboxDeliveries[act.targetId].push({
                        title: "[🤫] KHÓA NGHỊ LUẬN",
                        content: "Cổ họng bạn dính bùa câm lặng của Sói Câm Lặng! Sáng nay bạn không thể gõ chat thảo luận."
                    });
                }
            }

            // Kẻ Báo Thù (Avenger) & Mèo (Cat) Phong Ấn
            if (((act.role === "avenger" && act.actionType === "anesthetize") || (act.role === "cat" && act.actionType === "seal")) && act.targetId) {
                blockedCasters.add(act.targetId);
                
                initPlayerState(act.targetId);
                if (act.role === "avenger") playerStateUpdates[act.targetId].isAvengerAsleep = true;
                if (act.role === "cat") playerStateUpdates[act.targetId].isCatSealed = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[⚡] PHONG ẤN THÀNH CÔNG",
                    content: `Đã niêm phong hoàn toàn phép thuật đêm nay của ${playersMap[act.targetId]?.name}.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💤] TRẠNG THÁI PHONG ẤN",
                    content: "Kỹ năng đêm nay của bạn đã bị vô hiệu hóa! Bạn bị ép ngủ say qua lượt này."
                });
            }
        });

        // Loại bỏ các lệnh hành động bị khóa phép bởi Băng Tuyết hoặc Phong Ấn
        actionBuffer = actionBuffer.filter(act => !blockedCasters.has(act.srcId) && !frozenPlayers.has(act.srcId));

        // ==========================================
        // TICK 5: SE DUYÊN, THU PHỤC VÀ BIẾN ĐỔI PHE
        // ==========================================
        actionBuffer.forEach(act => {
            // Cupid Tơ Hồng
            if (act.role === "cupid" && act.actionType === "link_lovers" && act.targetId && act.secondaryId) {
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
                    content: `Đã gán duyên nợ thành công cho cặp đôi: ${playersMap[act.targetId]?.name} & ${playersMap[act.secondaryId]?.name}.`
                });

                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[💘] MŨI TÊN ÁI TÌNH",
                    content: `Mũi tên Cupid đã buộc sinh mệnh bạn vĩnh viễn với ${playersMap[act.secondaryId]?.name}!`
                });

                initMailbox(act.secondaryId);
                mailboxDeliveries[act.secondaryId].push({
                    title: "[💘] MŨI TÊN ÁI TÌNH",
                    content: `Mũi tên Cupid đã buộc sinh mệnh bạn vĩnh viễn với ${playersMap[act.targetId]?.name}!`
                });
            }

            // Nhà Truyền Giáo (Missionary)
            if (act.role === "missionary" && act.actionType === "convert" && act.targetId) {
                convertedPlayers.add(act.targetId);
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isMissionaryConverted = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🕍] TÍN ĐỒ MỚI",
                    content: `Đối tượng ${playersMap[act.targetId]?.name} đã quy thuận giáo phái.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🕍] LỜI KÊU GỌI TỪ THÁNH ĐƯỜNG",
                    content: "Tâm trí bạn được Nhà Truyền Giáo khai sáng! Bạn đã gia nhập thánh đường."
                });
            }

            // Ma Cà Rồng (Vampire) Bitten (Ưu tiên Sói cắn trước Bán Sói)
            if (act.role === "vampire" && act.actionType === "bite" && act.targetId) {
                vampireBittenPlayers.add(act.targetId);
                const vampireChatId = "vampire_" + roomId;

                initPlayerState(act.srcId);
                playerStateUpdates[act.srcId].vampireFactionId = vampireChatId;

                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isVampireBitten = true;
                playerStateUpdates[act.targetId].vampireFactionId = vampireChatId;

                // Nếu là Bán Sói VÀ KHÔNG bị Ma Sói cắn đêm nay -> Biến đổi thành Vampire
                const targetP = playersMap[act.targetId];
                if (targetP && targetP.role === "halfWolf" && !playerStateUpdates[act.targetId]?.role) {
                    playerStateUpdates[act.targetId].realFaction = "third";
                    playerStateUpdates[act.targetId].role = "vampire";
                }

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🧛] VẾT CẮN BÓNG ĐÊM",
                    content: `Đã truyền dấu ấn Huyết Tộc lên cổ của ${playersMap[act.targetId]?.name}.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🩸] VẾT CẮN BÓNG ĐÊM",
                    content: "Bạn đã bị Vampire cắn đêm qua! Bạn được mở kênh chat Huyết Tộc."
                });
            }

            // Vẹt (Parrot) Nhái Giọng
            if (act.role === "parrot" && act.actionType === "mimic" && act.targetId) {
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🦜] BÙA CHÚ LẶP LẠI",
                    content: `Ép buộc ${playersMap[act.targetId]?.name} phải nói câu: '${act.phrase}' sáng mai.`
                });
                initMailbox(act.targetId);
                mailboxDeliveries[act.targetId].push({
                    title: "[🦜] LỜI NGUYỀN CON VẸT",
                    content: `Cổ họng bạn bị điều khiển! Bắt buộc sáng nay bạn phải phát ngôn câu: "${act.phrase}".`
                });
            }
        });

        // ==========================================
        // TICK 6: TÍNH TOÁN SÁT THƯƠNG, BẦY SÓI ĐỒNG THUẬN VÀ PHÙ THỦY
        // ==========================================
        const damageQueue = []; 
        let witchHealTarget = null;
        const witchPoisonTargets = new Set();

        // 6.1 GOM PHIẾU BẦU BẦY SÓI (SỬA LỖI ĐỒNG THUẬN CẮN SÓI)
        const wolfVotesNode = roomData.wolf_votes || {};
        const wolfVoteCounts = {};
        
        Object.values(wolfVotesNode).forEach(targetId => {
            if (targetId) wolfVoteCounts[targetId] = (wolfVoteCounts[targetId] || 0) + 1;
        });

        actionBuffer.forEach(act => {
            if ((act.role === "wolf" || act.role === "wolfBoss" || act.role === "loneWolf" || act.actionType === "wolf_bite") && act.targetId) {
                wolfVoteCounts[act.targetId] = (wolfVoteCounts[act.targetId] || 0) + 1;
            }
        });

        let wolfConsensusTarget = null;
        let maxWolfVotes = 0;
        
        // Sói Trùm phủ quyết
        const wolfBossPlayer = playersList.find(p => p.alive && p.role === "wolfBoss");
        if (wolfBossPlayer && wolfBossPlayer.targetSelection?.targetId) {
            wolfConsensusTarget = wolfBossPlayer.targetSelection.targetId;
        } else {
            Object.entries(wolfVoteCounts).forEach(([tid, count]) => {
                if (count > maxWolfVotes) {
                    maxWolfVotes = count;
                    wolfConsensusTarget = tid;
                }
            });
        }

        // Xử lý Bán Sói (Half-Wolf) bị Sói cắn -> Ưu tiên chuyển hóa thành Sói thay vì chết
        if (wolfConsensusTarget) {
            const wolfVictim = playersMap[wolfConsensusTarget];
            if (wolfVictim && wolfVictim.role === "halfWolf") {
                initPlayerState(wolfConsensusTarget);
                playerStateUpdates[wolfConsensusTarget].role = "wolf";
                playerStateUpdates[wolfConsensusTarget].realFaction = "wolf";
                
                initMailbox(wolfConsensusTarget);
                mailboxDeliveries[wolfConsensusTarget].push({
                    title: "[🐺] SỰ CHUYỂN HÓA BÁN SÓI",
                    content: "Bạn đã bị Ma Sói cắn đêm qua! Bản năng Ma Sói thức tỉnh, bạn chính thức trở thành MA SÓI.",
                    category: "system"
                });
            } else {
                damageQueue.push({ targetId: wolfConsensusTarget, sourceRole: "wolf" });
                initPlayerState(wolfConsensusTarget);
                playerStateUpdates[wolfConsensusTarget].isWolfTargeted = true;
            }
        }

        // 6.2 Phù Thủy (Witch) Phân Giải Bình
        actionBuffer.forEach(act => {
            if (act.role === "witch") {
                const witchPlayer = playersMap[act.srcId];

                // Bình Cứu (Cứu nạn nhân bị Sói cắn)
                if (act.actionType === "heal" && act.targetId && (!witchPlayer || !witchPlayer.hasUsedHeal)) {
                    witchHealTarget = act.targetId;
                    
                    initPlayerState(act.srcId);
                    playerStateUpdates[act.srcId].hasUsedHeal = true; // Khóa vĩnh viễn
                    
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isWitchHealed = true;

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🧪] BÌNH CỨU SINH MỆNH",
                        content: `Bạn đã tưới bình Dược Thủy hồi sinh cho ${playersMap[act.targetId]?.name}. (Bình cứu đã dùng xong)`
                    });
                }

                // Bình Độc (Hạ sát trực tiếp mục tiêu)
                if (act.actionType === "poison" && act.targetId && (!witchPlayer || !witchPlayer.hasUsedPoison)) {
                    witchPoisonTargets.add(act.targetId);

                    initPlayerState(act.srcId);
                    playerStateUpdates[act.srcId].hasUsedPoison = true; // Khóa vĩnh viễn

                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isWitchPoisoned = true;

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[☠️] BÌNH ĐỘC DƯỢC",
                        content: `Bạn đã dội bình độc dược lên ${playersMap[act.targetId]?.name}. (Bình độc đã dùng xong)`
                    });
                }
            }
        });

        // 6.3 Gom Sát Thương Khác: Sát Nhân, Báo Thù, Mèo, Mạo Danh
        actionBuffer.forEach(act => {
            if (act.role === "serialKiller" && act.actionType === "serial_kill" && act.targetId) {
                damageQueue.push({ targetId: act.targetId, sourceRole: "serialKiller" });
            }
            if (act.role === "avenger" && act.actionType === "execute" && act.targetId) {
                damageQueue.push({ targetId: act.targetId, sourceRole: "avenger" });
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isAvengerExecuted = true;
            }
            if (act.role === "cat" && act.actionType === "tear" && act.targetId) {
                damageQueue.push({ targetId: act.targetId, sourceRole: "cat" });
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isCatClawed = true;
            }
            if (act.role === "impostor" && act.actionType === "lethal_slash" && act.targetId) {
                damageQueue.push({ targetId: act.targetId, sourceRole: "impostor" });
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isLethalSlashed = true;
            }
        });

        // 6.4 Kẻ Phóng Hỏa (Arsonist) Tẩm Xăng & Châm Lửa
        actionBuffer.forEach(act => {
            if (act.role === "arsonist") {
                if (act.actionType === "pour_petrol" && act.targetId) {
                    newlyPetroled.add(act.targetId);
                    if (act.secondaryId) newlyPetroled.add(act.secondaryId);

                    [act.targetId, act.secondaryId].filter(id => id !== null).forEach(id => {
                        initPlayerState(id);
                        playerStateUpdates[id].isPetroled = true; 
                        playerStateUpdates[id].isArsonistPetroled = true;
                    });

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🛢️] TẨM XĂNG ĐÊM ĐEN",
                        content: `Đã dội dầu tưới xăng lên căn nhà của ${playersMap[act.targetId]?.name}.`
                    });
                } else if (act.actionType === "ignite") {
                    // CHỈ thiêu rụi mục tiêu đã tẩm xăng từ ĐÊM TRƯỚC (alreadyPetroled), KHÔNG đốt mục tiêu mới tẩm đêm nay
                    playersList.forEach(p => {
                        if (alreadyPetroled.has(p.id)) {
                            damageQueue.push({ targetId: p.id, sourceRole: "arsonist" });
                            initPlayerState(p.id);
                            playerStateUpdates[p.id].isArsonistIgnited = true;
                        }
                    });
                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔥] THẢ NGỌN LỬA TỰ DO",
                        content: "Bạn đã châm mồi lửa bùng cháy toàn bộ các mục tiêu bị dội xăng từ trước!"
                    });
                }
            }
        });

        // 6.5 Duyệt Hàng Chờ Sát Thương
        damageQueue.forEach(dmg => {
            const { targetId, sourceRole } = dmg;

            // Nếu được Phù Thủy Cứu VÀ đòn đánh là của Ma Sói -> Hồi sinh
            if (targetId === witchHealTarget && sourceRole === "wolf") {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🧪] CỨU MẠNG BỞI PHÙ THỦY",
                    content: "Nanh vuốt Ma Sói đã cào xé bạn, nhưng bình Dược Thủy của Phù Thủy đã kịp thời cứu sống bạn!"
                });
                return;
            }

            // Hiệp Sĩ Không Đầu Miễn Nhiễm Đêm 1 với MỌI đòn tấn công
            if (playersMap[targetId]?.role === "headlessKnight" && currentDay === 1) {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🎃] BẢN NĂNG KHÔNG ĐẦU",
                    content: "Đòn tấn công đã giáng xuống nhưng bạn miễn nhiễm hoàn toàn vào Đêm đầu tiên!"
                });
                return;
            }

            // Sát Nhân (Serial Killer) & Kẻ Báo Thù (Avenger) ĐÂM XUYÊN lá chắn Bảo Vệ
            if (sourceRole === "serialKiller" || sourceRole === "avenger") {
                deathsSet.add(targetId);
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: sourceRole === "serialKiller" ? "[🔪] NHÁT ĐÂM SÁT NHÂN" : "[⚔️] NHÁT CHÉM TỬ HÌNH",
                    content: "Đòn tấn công chí mạng đã đâm xuyên qua mọi lá chắn bảo vệ!"
                });
                return;
            }

            // Lá chắn Bảo Vệ che chở (Ngoại trừ Kẻ Phóng Hỏa, Sát Nhân, Báo Thù)
            if (protectedPlayers.has(targetId) && sourceRole !== "arsonist") {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🛡️] BẢO VỆ LÁ CHẮN THÀNH CÔNG",
                    content: "Bóng đêm tấn công bạn nhưng lá chắn Bảo Vệ đã che chở an toàn!"
                });
                return;
            }

            // Thân Cận Chủ Thần miễn nhiễm Sói cắn
            if (primeFollowers.has(targetId) && sourceRole === "wolf") {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🌌] CHỦ THẦN CHE CHỞ",
                    content: "Uy áp Chủ Thần đã đẩy lùi nanh vuốt Ma Sói khỏi thể xác bạn!"
                });
                return;
            }

            deathsSet.add(targetId);
        });

        // Độc Phù Thủy tác động trực tiếp
        witchPoisonTargets.forEach(targetId => {
            // Hiệp Sĩ Không Đầu vẫn miễn nhiễm độc Đêm 1
            if (playersMap[targetId]?.role === "headlessKnight" && currentDay === 1) {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🎃] BẢN NĂNG KHÔNG ĐẦU",
                    content: "Bình độc Phù Thủy đã tưới lên người nhưng bạn miễn nhiễm hoàn toàn vào Đêm 1!"
                });
                return;
            }

            deathsSet.add(targetId);
            initMailbox(targetId);
            mailboxDeliveries[targetId].push({
                title: "[☠️] TỬ VONG BỞI ĐỘC DƯỢC",
                content: "Bạn ngấm độc dược cực mạnh của Phù Thủy và tử vong lập tức!"
            });
        });

        // Cặp Đôi Uyên Ương (Cupid Lovers) Chết Cùng Nhau (Chống lặp Mật thư)
        const processedLovers = new Set();
        playersList.forEach(p => {
            if (p.inCouple && deathsSet.has(p.id) && p.coupleId && !processedLovers.has(p.coupleId)) {
                processedLovers.add(p.coupleId);
                playersList.forEach(partner => {
                    if (partner.coupleId === p.coupleId && partner.id !== p.id && partner.alive) {
                        deathsSet.add(partner.id);
                        initMailbox(partner.id);
                        mailboxDeliveries[partner.id].push({
                            title: "[💘] TÌNH YÊU BẤT TỬ",
                            content: `Người tình [${p.name}] của bạn đã gục ngã! Trái tim bạn tan vỡ và gieo mình tự sát chết theo.`
                        });
                    }
                });
            }
        });

        // ==========================================
        // TICK 7: PHẢN SÁT VÀ PHÁT BẮN CUỐI CÙNG (DEATH RETALIATIONS)
        // ==========================================
        playersList.forEach(p => {
            // Thợ Săn (Hunter) Chết Đêm Nổ Súng
            if (p.role === "hunter" && deathsSet.has(p.id) && p.targetSelection) {
                let hunterTarget = p.targetSelection.targetId;
                hunterTarget = getRoutedTarget(p.id, hunterTarget);

                if (hunterTarget && hunterTarget !== "neutralized" && playersMap[hunterTarget] && playersMap[hunterTarget].alive) {
                    deathsSet.add(hunterTarget);
                    
                    initPlayerState(p.id);
                    playerStateUpdates[p.id].isHunterMarked = true;

                    initMailbox(hunterTarget);
                    mailboxDeliveries[hunterTarget].push({
                        title: "[🏹] PHÁT BẮN TIỄN BIỆT",
                        content: `Thợ Săn [${p.name}] ngã xuống đã bóp cò ghim phát đạn hạ sát bạn!`
                    });
                }
            }
        });

        // Sập bẫy Kẻ Thanh Trừng (Eradicator)
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
                            title: "[⚔️] SẬP BẪY THANH TRỪNG",
                            content: "Bạn đã tác động kỹ năng vào Kẻ Thanh Trừng và dính bẫy sắt tử vong!"
                        });
                    }
                });
            }
        });

        // ==========================================
        // TICK 8: TRUY XUẤT THÔNG TIN, SOI VAI TRÒ VÀ ĐỒNG BỘ CHANNEL
        // ==========================================
        actionBuffer.forEach(act => {
            // Tiên Tri (Seer)
            if (act.role === "seer" && (act.actionType === "seer_scan" || act.actionType === "seer_open_eye") && act.targetId) {
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
                        content: `Hào quang vũ trụ hoàn tất! Linh hồn của ${playersMap[originalTarget]?.name} thuộc về: ${factionResult}.`
                    });
                } else {
                    const realRoleName = targetPlayer ? targetPlayer.role.toUpperCase() : "DÂN LÀNG";
                    const realFactionName = targetPlayer ? targetPlayer.realFaction.toUpperCase() : "DÂN LÀNG";
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔮] KẾT QUẢ KHAI NHÃN",
                        content: `Soi thấu ngụy trang! Vai trò thực của ${playersMap[originalTarget]?.name} là: [${realRoleName}] (Phe ${realFactionName}).`
                    });
                }
            }

            // Cảnh Sát Trưởng (Police)
            if (act.role === "police" && act.actionType === "check_weapon" && act.targetId) {
                const targetPlayer = playersMap[act.targetId];
                const dangerousRoles = ["hunter", "serialKiller", "arsonist", "witch", "impostor", "wolf"];
                const hasWeapon = targetPlayer && dangerousRoles.includes(targetPlayer.role);

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🔫] KẾT QUẢ TẦM SOÁT",
                    content: `Kiểm tra hành trang của [${targetPlayer?.name}]: ${hasWeapon ? "PHÁT HIỆN VŨ KHÍ TẤN CÔNG ⚠️" : "AN TOÀN KHÔNG VŨ KHÍ ✅"}.`
                });
            }

            // Pháp Sư Sói (Wolf Mage)
            if (act.role === "wolfMage" && act.actionType === "scan_seer" && act.targetId) {
                const targetPlayer = playersMap[act.targetId];
                const isSeer = targetPlayer && (targetPlayer.role === "seer" || targetPlayer.role === "apprenticeSeer");
                
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isWolfMageScanned = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🧿] MA PHÁP DÒ ĐƯỜNG",
                    content: `Kiểm tra ${targetPlayer?.name}. Kết quả: ${isSeer ? "LÀ VAI TRÒ TIÊN TRI 🔮" : "KHÔNG PHẢI TIÊN TRI ❌"}.`
                });
            }

            // Tử Thần (Reaper) Dự Đoán Linh Hồn
            if (act.role === "reaper" && act.actionType === "predict_death" && act.targetId) {
                const targetPlayer = playersMap[act.targetId];
                const isDeadTonight = deathsSet.has(act.targetId);

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[💀] LƯỠI HÁI TIÊN TRI",
                    content: `Dự đoán linh hồn của ${targetPlayer?.name}: ${isDeadTonight ? "ĐÃ THU HOẠCH THÀNH CÔNG 🩸" : "DỰ ĐOÁN SAI MỤC TIÊU ❌"}.`
                });
            }
        });

        // Thiết lập động kênh chat Tử Thần (Reaper Channel)
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