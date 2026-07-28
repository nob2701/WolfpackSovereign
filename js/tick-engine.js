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

        // Khởi tạo tập dữ liệu ghi nhận sau phân giải
        const deathsSet = new Set();
        const mailboxDeliveries = {}; 
        const playerStateUpdates = {}; 
        
        const initMailbox = (pid) => {
            if (!mailboxDeliveries[pid]) mailboxDeliveries[pid] = [];
        };

        const initPlayerState = (pid) => {
            if (!playerStateUpdates[pid]) playerStateUpdates[pid] = {};
        };

        // RESET SẠCH BÙA CHÚ TẠM THỜI CỦA ĐÊM TRƯỚC (Tránh dính bùa vĩnh viễn)
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

        // Thu thập toàn bộ hành động từ các người chơi còn sống
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

        // Lọc bỏ hành động nhắm vào người không tồn tại
        actionBuffer = actionBuffer.filter(act => {
            if (act.targetId && !playersMap[act.targetId]) return false;
            if (act.secondaryId && !playersMap[act.secondaryId]) return false;
            return true;
        });

        // Tập hợp cấu trúc định tuyến kỹ năng
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

        // ==========================================
        // TICK 2: ĐÁNH TRÁO, ĐIỀU HƯỚNG VÀ ĐẶT BẪY
        // ==========================================
        
        // 2.1 Sói Ảo Ảnh (Phantom Wolf) Hoán Đổi Nhãn Dạng
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

        // Áp dụng tráo đổi nhân dạng lên các kỹ năng còn lại
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

        // 2.2 Kẻ Thao Túng (Manipulator) Bẻ Hướng Kỹ Năng
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

        // 2.3 Kẻ Thanh Trừng (Eradicator) Đặt Bẫy Thép
        actionBuffer.forEach(act => {
            if (act.role === "eradicator" && act.actionType === "set_trap") {
                trappedPlayers[act.srcId] = [act.targetId, act.secondaryId];
                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[⚔️] PHÒNG THỦ THANH TRỪNG",
                    content: `Đã thiết lập bẫy phòng thủ giám sát 2 mục tiêu: ${playersMap[act.targetId]?.name} & ${playersMap[act.secondaryId]?.name}.`
                });
            }
        });

        // ==========================================
        // TICK 3: BẢO VỆ, LÁ CHẮN VÀ GƯƠNG PHẢN CHIẾU
        // ==========================================
        
        // 3.1 Bảo Vệ (Guard) Tuần Tra
        actionBuffer.forEach(act => {
            if (act.role === "guard" && act.actionType === "protect") {
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
            if (act.role === "wolfSnow" && act.actionType === "freeze") {
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

        // 3.4 Kẻ Phản Chiếu (Reflector) Dựng Kính
        actionBuffer.forEach(act => {
            if (act.role === "reflector" && act.actionType === "set_mirror") {
                mirrorsMap[act.targetId] = act.srcId; 
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isReflectorMirrored = true;

                initMailbox(act.srcId);
                mailboxDeliveries[act.srcId].push({
                    title: "[🪞] KÍNH PHẢN QUANG",
                    content: `Đã dựng kính phản chiếu ma thuật trước cửa nhà ${playersMap[act.targetId]?.name}.`
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

        // Bẻ hướng toàn bộ hành động qua gương phản chiếu
        actionBuffer.forEach(act => {
            if (act.actionType !== "set_mirror" && act.actionType !== "protect") {
                act.targetId = getRoutedTarget(act.srcId, act.targetId);
            }
        });

        // ==========================================
        // TICK 4: KHÓA PHÉP, PHONG ẤN VÀ CÂM LẶNG
        // ==========================================
        actionBuffer.forEach(act => {
            // Sói Câm Lặng (Silencer)
            if (act.role === "silencerWolf" && act.actionType === "silence") {
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
            if ((act.role === "avenger" && act.actionType === "anesthetize") || (act.role === "cat" && act.actionType === "seal")) {
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

        // Loại bỏ các lệnh hành động bị khóa phép
        actionBuffer = actionBuffer.filter(act => !blockedCasters.has(act.srcId));

        // ==========================================
        // TICK 5: SE DUYÊN, THU PHỤC VÀ BIẾN ĐỔI PHE
        // ==========================================
        actionBuffer.forEach(act => {
            // Cupid Tơ Hồng
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
            if (act.role === "missionary" && act.actionType === "convert") {
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

            // Ma Cà Rồng (Vampire) Bitten
            if (act.role === "vampire" && act.actionType === "bite") {
                vampireBittenPlayers.add(act.targetId);
                const vampireChatId = "vampire_" + roomId;

                initPlayerState(act.srcId);
                playerStateUpdates[act.srcId].vampireFactionId = vampireChatId;

                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isVampireBitten = true;
                playerStateUpdates[act.targetId].vampireFactionId = vampireChatId;

                // Kiểm tra Bán Sói (Half Wolf) chuyển hóa thành Sói
                if (playersMap[act.targetId]?.role === "halfWolf") {
                    playerStateUpdates[act.targetId].realFaction = "wolf";
                    playerStateUpdates[act.targetId].role = "wolf";
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
            if (act.role === "parrot" && act.actionType === "mimic") {
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
        // TICK 6: TÍNH TOÁN SÁT THƯƠNG VÀ BÌNH CỨU PHÙ THỦY
        // ==========================================
        const damageQueue = []; 
        let witchHealTarget = null;
        const witchPoisonTargets = new Set();

        // 6.1 Phù Thủy (Witch) phân giải bình
        actionBuffer.forEach(act => {
            if (act.role === "witch") {
                if (act.actionType === "heal") {
                    witchHealTarget = act.targetId;
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isWitchHealed = true;

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🧪] BÌNH CỨU SINH MỆNH",
                        content: `Bạn đã tưới bình Dược Thủy hồi sinh cho ${playersMap[act.targetId]?.name}.`
                    });
                }
                if (act.actionType === "poison") {
                    witchPoisonTargets.add(act.targetId);
                    initPlayerState(act.targetId);
                    playerStateUpdates[act.targetId].isWitchPoisoned = true;

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[☠️] BÌNH ĐỘC DƯỢC",
                        content: `Bạn đã hạ độc dội xuống người ${playersMap[act.targetId]?.name}.`
                    });
                }
            }
        });

        // 6.2 Gom sát thương từ Ma Sói, Sát Nhân, Kẻ Báo Thù, Mèo, Kẻ Mạo Danh
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
            if (act.role === "impostor" && act.actionType === "lethal_slash") {
                damageQueue.push({ targetId: act.targetId, sourceRole: "impostor" });
                initPlayerState(act.targetId);
                playerStateUpdates[act.targetId].isLethalSlashed = true;
            }
        });

        // 6.3 Kẻ Phóng Hỏa (Arsonist) Tẩm Xăng & Châm Lửa
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

                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🛢️] TẨM XĂNG ĐÊM ĐEN",
                        content: `Đã dội dầu tưới xăng lên căn nhà của ${playersMap[act.targetId]?.name}.`
                    });
                } else if (act.actionType === "ignite") {
                    playersList.forEach(p => {
                        if (p.isPetroled || newlyPetroled.has(p.id)) {
                            damageQueue.push({ targetId: p.id, sourceRole: "arsonist" });
                            initPlayerState(p.id);
                            playerStateUpdates[p.id].isArsonistIgnited = true;
                        }
                    });
                    initMailbox(act.srcId);
                    mailboxDeliveries[act.srcId].push({
                        title: "[🔥] THẢ NGỌN LỬA TỰ DO",
                        content: "Bạn đã châm mồi lửa bùng cháy toàn bộ các mục tiêu bị tẩm xăng!"
                    });
                }
            }
        });

        // 6.4 Xử lý duyệt hàng chờ sát thương
        damageQueue.forEach(dmg => {
            const { targetId, sourceRole } = dmg;

            // Phù Thủy Cứu -> Hủy sát thương
            if (targetId === witchHealTarget) {
                initMailbox(targetId);
                mailboxDeliveries[targetId].push({
                    title: "[🧪] CỨU MẠNG BỞI PHÙ THỦY",
                    content: "Nanh vuốt ma thuật đã vồ lấy bạn, nhưng bình dược thủy của Phù Thủy đã chữa lành vết thương!"
                });
                return;
            }

            // Bảo Vệ lá chắn che chở (Ngoại trừ Kẻ Phóng Hỏa)
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

            // Ghi nhận tử vong
            deathsSet.add(targetId);
        });

        // Độc Phù Thủy tác động trực tiếp
        witchPoisonTargets.forEach(targetId => {
            deathsSet.add(targetId);
            initMailbox(targetId);
            mailboxDeliveries[targetId].push({
                title: "[☠️] TỬ VONG BỞI ĐỘC DƯỢC",
                content: "Bạn ngấm độc dược cực mạnh của Phù Thủy và tử vong lập tức!"
            });
        });

        // Xử lý Cặp Đôi Uyên Ương (Cupid Couple) Chết Cùng Nhau
        playersList.forEach(p => {
            if (p.inCouple && deathsSet.has(p.id) && p.coupleId) {
                playersList.forEach(partner => {
                    if (partner.coupleId === p.coupleId && partner.id !== p.id && partner.alive) {
                        deathsSet.add(partner.id);
                        initMailbox(partner.id);
                        mailboxDeliveries[partner.id].push({
                            title: "[💘] TÌNH YÊU BẤT TỬ",
                            content: `Người tình [${p.name}] của bạn đã gục ngã! Trái tim bạn tan vỡ và chết theo gieo mình tự sát.`
                        });
                    }
                });
            }
        });

        // ==========================================
        // TICK 7: PHẢN SÁT VÀ PHÁT BẮN CUỐI CÙNG (DEATH RETALIATIONS)
        // ==========================================
        playersList.forEach(p => {
            // Thợ Săn (Hunter) chết đêm nổ súng
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
        // TICK 8: TRUY XUẤT THÔNG TIN VÀ SOI VAI TRÒ
        // ==========================================
        actionBuffer.forEach(act => {
            // Tiên Tri (Seer)
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

            // Pháp Sư Sói (Wolf Mage)
            if (act.role === "wolfMage" && act.actionType === "scan_seer") {
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