import { 
    db, ref, set, get, onValue, update, push, onDisconnect 
} from "./firebase-config.js";
import { StateMachine } from "./state-machine.js";
import { 
    openTargetSelection, ModalManager, initMobileTabSync, showPlayerBottomSheet, setupSoundSettings, showToast, askConfirm
} from "./ui-manager.js";
import { ROLE_DB, ROLE_ICONS, FACTION_ICONS, getRoleName } from "./game-logic.js";

// Trạng thái mạng và đồng bộ cục bộ của Client
export const Net = {
    roomId: null,
    playerId: null,
    playerName: "",
    isHost: false,
    players: {}, 
    connectedRef: null,
    currentChannel: "public",
    mailCategory: "all"
};

// Theo dõi danh sách mật thư để hỗ trợ điều hướng đọc liên tục
let openedMailsList = [];
let currentMailIndex = -1;

// Khởi tạo ứng dụng khi DOM tải xong
document.addEventListener("DOMContentLoaded", () => {
    initLobbyEngine();
    setupCodeInputNavigation();
    initMobileTabSync();
    setupSoundSettings();
    setupChatEngine();
    setupSpectatorWinPoll();
    setupMailboxCategoryFilters();
    setupParchmentNavigation();
    dismissSplashScreen();
});

// Gỡ bỏ màn hình chờ
function dismissSplashScreen() {
    const splash = document.getElementById("splash-screen");
    if (splash) {
        const dismiss = () => {
            splash.classList.add("hidden");
        };
        splash.addEventListener("click", dismiss);
        setTimeout(dismiss, 1500);
    }
}

// ==========================================
// 1. LUỒNG ĐĂNG KÝ VÀ KIỂM TRA ĐẦU VÀO (LOGIN ENGINE)
// ==========================================
function initLobbyEngine() {
    const nameInput = document.getElementById("player-name-input");
    const btnInitialJoin = document.getElementById("btn-initial-join-trigger");
    const btnCreate = document.getElementById("btn-create-room");
    const btnJoinSubmit = document.getElementById("btn-join-room-submit");
    const btnBackToLogin = document.getElementById("btn-back-to-login");
    const btnCopyRoom = document.getElementById("btn-copy-room-id");
    const btnToggleReady = document.getElementById("btn-player-toggle-ready");
    const btnHostStartSetup = document.getElementById("btn-host-start-setup");

    // Khôi phục tên cũ nếu đã lưu
    const savedName = localStorage.getItem("online_player_name");
    if (savedName && nameInput) {
        nameInput.value = savedName;
        Net.playerName = savedName;
        btnInitialJoin.disabled = savedName.length < 2;
        btnCreate.disabled = savedName.length < 2;
    }

    if (nameInput) {
        nameInput.addEventListener("input", () => {
            const cleanName = nameInput.value.trim().replace(/[^a-zA-Z0-9\sÀ-ỹ]/g, "");
            nameInput.value = cleanName;
            const isValid = cleanName.length >= 2;
            btnInitialJoin.disabled = !isValid;
            btnCreate.disabled = !isValid;
            Net.playerName = cleanName;
        });
    }

    if (btnInitialJoin) {
        btnInitialJoin.addEventListener("click", () => {
            localStorage.setItem("online_player_name", Net.playerName);
            document.getElementById("login-form-panel").classList.add("hidden");
            document.getElementById("join-code-panel").classList.remove("hidden");
        });
    }

    if (btnBackToLogin) {
        btnBackToLogin.addEventListener("click", () => {
            document.getElementById("join-code-panel").classList.add("hidden");
            document.getElementById("login-form-panel").classList.remove("hidden");
        });
    }

    if (btnCreate) btnCreate.addEventListener("click", createRoom);
    if (btnJoinSubmit) btnJoinSubmit.addEventListener("click", joinRoomFromInputs);
    if (btnCopyRoom) btnCopyRoom.addEventListener("click", copyRoomId);
    if (btnToggleReady) btnToggleReady.addEventListener("click", toggleReadyState);
    if (btnHostStartSetup) btnHostStartSetup.addEventListener("click", hostStartSetup);

    // Sự kiện cưỡng chế sang ngày của GM (Force Day Transition Click Handler)
    document.getElementById("btn-gm-force-day")?.addEventListener("click", () => {
        askConfirm("Bạn có chắc chắn muốn cưỡng chế chuyển sang BAN NGÀY lập tức? Mọi hành động chưa thực hiện của người chơi đêm nay sẽ bị bỏ qua!", () => {
            StateMachine.forceTransitionToDay();
        });
    });
}

// Logic dịch chuyển con trỏ tự động 6 ô nhập mã phòng
function setupCodeInputNavigation() {
    const inputs = document.querySelectorAll(".code-input");
    inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
            input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (input.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
            checkCodeComplete();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

function checkCodeComplete() {
    const inputs = document.querySelectorAll(".code-input");
    let code = "";
    inputs.forEach(i => code += i.value);
    const btnJoinSubmit = document.getElementById("btn-join-room-submit");
    if (btnJoinSubmit) {
        btnJoinSubmit.disabled = code.length !== 6;
    }
}

// ==========================================
// 2. KẾT NỐI: TẠO PHÒNG VÀ ĐỒNG BỘ TRẠNG THÁI CHỜ
// ==========================================
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function createRoom() {
    if (Net.playerName.length < 2) return;
    const roomId = generateRoomCode();
    Net.roomId = roomId;
    Net.playerId = "host_" + Date.now();
    Net.isHost = true;

    const roomRef = ref(db, `rooms/${roomId}`);
    const hostData = {
        id: Net.playerId,
        name: Net.playerName,
        isHost: true,
        isReady: true,
        isConnected: true,
        alive: true,
        role: "villager",
        realFaction: "villager",
        turnEnded: false,
        hasSeenRole: false
    };

    const initialRoomState = {
        meta: {
            hostId: Net.playerId,
            roomId: roomId,
            phase: "setup",
            day: 0,
            started: false,
            createdTime: Date.now()
        },
        players: {
            [Net.playerId]: hostData
        },
        roleCounts: {
            villager: 1
        }
    };

    try {
        await set(roomRef, initialRoomState);
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        showToast("Lỗi khi kết nối máy chủ để khởi tạo phòng!", "danger");
    }
}

function joinRoomFromInputs() {
    const inputs = document.querySelectorAll(".code-input");
    let code = "";
    inputs.forEach(i => code += i.value);
    
    if (code.length === 6) {
        joinRoom(code, Net.playerName);
    }
}

async function joinRoom(roomId, name) {
    const roomRef = ref(db, `rooms/${roomId}`);
    try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            showToast("Mã phòng không tồn tại!", "danger");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.meta.started) {
            showToast("Ván đấu trong phòng đã bắt đầu, không thể tham gia!", "danger");
            return;
        }

        Net.roomId = roomId;
        Net.playerId = "player_" + Date.now();
        Net.isHost = false;

        const playerRef = ref(db, `rooms/${roomId}/players/${Net.playerId}`);
        const playerData = {
            id: Net.playerId,
            name: name,
            isHost: false,
            isReady: false,
            isConnected: true,
            alive: true,
            role: "villager",
            realFaction: "villager",
            turnEnded: false,
            hasSeenRole: false
        };

        await set(playerRef, playerData);
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        showToast("Gặp sự cố khi gia nhập phòng trực tuyến!", "danger");
    }
}

function enterLobbyMode() {
    document.getElementById("login-form-panel").classList.add("hidden");
    document.getElementById("join-code-panel").classList.add("hidden");
    document.getElementById("lobby-room-status").classList.remove("hidden");
    document.getElementById("current-room-display").innerText = Net.roomId;

    const hostCtrl = document.getElementById("lobby-host-controls");
    const playerCtrl = document.getElementById("lobby-player-controls");
    const waitingMsg = document.getElementById("lobby-waiting-msg");

    if (Net.isHost) {
        hostCtrl.classList.remove("hidden");
        playerCtrl.classList.add("hidden");
        waitingMsg.classList.add("hidden");
    } else {
        hostCtrl.classList.add("hidden");
        playerCtrl.classList.remove("hidden");
        waitingMsg.classList.remove("hidden");
    }
}

function setupActivePlayersPresence() {
    const connectionRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isConnected`);
    set(connectionRef, true);
    onDisconnect(connectionRef).set(false);
}

// ==========================================
// 3. ĐỒNG BỘ THỜI GIAN THỰC TỪ FIREBASE
// ==========================================
function listenToRoom() {
    setupActivePlayersPresence();

    const roomRef = ref(db, `rooms/${Net.roomId}`);
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const roomData = snapshot.val();
        
        // Cập nhật cấu hình toàn cục cục bộ
        window.G.day = roomData.meta.day || 0;
        window.G.phase = roomData.meta.phase || "setup";
        window.G.players = Object.values(roomData.players || {});
        window.G.roleCounts = roomData.roleCounts || {};
        Net.players = roomData.players || {};

        const mySelf = Net.players[Net.playerId];

        // ĐỒNG BỘ GM & SPECTATOR: GM nhìn thấy vai trò của tất cả người chơi
        if (Net.isHost) {
            renderUnmaskedSpectatorGrid();
        } else {
            renderNormalPlayerGrid();
        }

        // Cập nhật số lượng người kết nối trong lobby
        const connectedCount = window.G.players.filter(p => p.isConnected).length;
        const lobbyConnectedEl = document.getElementById("lobby-connected-count");
        if (lobbyConnectedEl) lobbyConnectedEl.innerText = connectedCount;

        // Cập nhật giao diện phòng chờ nếu chưa bắt đầu
        if (!roomData.meta.started) {
            renderLobbyPlayersList();
            
            // Host chỉ có thể bắt đầu khi tất cả người chơi khác đã READY
            if (Net.isHost) {
                const otherPlayers = window.G.players.filter(p => p.id !== Net.playerId);
                const allReady = otherPlayers.length > 0 && otherPlayers.every(p => p.isReady);
                document.getElementById("btn-host-start-setup").disabled = !allReady;
            }
        } else {
            // Nếu game đã bắt đầu, tiến hành chuyển màn hình vào game
            if (document.body.getAttribute("data-view") === "lobby") {
                transitionToGameScreen(roomData);
            }

            // SỬA LỖI 3 & 4: Xử lý xem bài & reconnect cho người chơi chưa xác nhận xem role
            if (mySelf && mySelf.hasSeenRole === false) {
                triggerCardFlipModal(mySelf);
            }

            syncLayoutBasedOnRoleAndStatus(roomData);
            syncTrialPhases(roomData);
            updateSovereignStatusAndGuide(roomData);
        }

        updateBalanceAndCountsUI();
    });

    // Lắng nghe hộp thư Mailbox trực tiếp
    if (!Net.isHost) {
        const mailboxRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`);
        onValue(mailboxRef, (snap) => {
            const mails = snap.val() || {};
            renderMailbox(mails);
        });
    }

    // Lắng nghe dòng nhật ký GM
    if (Net.isHost) {
        const logsRef = ref(db, `rooms/${Net.roomId}/logs`);
        onValue(logsRef, (snap) => {
            const logs = snap.val() || {};
            renderGMLogs(logs);
        });
    }
}

function renderLobbyPlayersList() {
    const listContainer = document.getElementById("lobby-players-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    window.G.players.forEach(p => {
        const tag = document.createElement("div");
        tag.className = "lobby-player-tag";
        
        const nameSpan = document.createElement("span");
        nameSpan.innerText = p.name + (p.isHost ? " 👑" : "");
        nameSpan.style.fontWeight = "bold";

        const badge = document.createElement("span");
        if (p.isHost) {
            badge.className = "status-badge ready";
            badge.innerText = "Quản trò";
        } else {
            badge.className = p.isReady ? "status-badge ready" : "status-badge waiting";
            badge.innerText = p.isReady ? "Sẵn sàng" : "Chờ...";
        }

        tag.appendChild(nameSpan);
        tag.appendChild(badge);
        listContainer.appendChild(tag);
    });
}

function transitionToGameScreen(roomData) {
    document.body.setAttribute("data-view", "game");
    document.getElementById("lobby-screen").classList.add("hidden");
    document.getElementById("game-screen").classList.remove("hidden");

    if (Net.isHost) {
        document.getElementById("gm-timeline-container").classList.remove("hidden");
        document.getElementById("player-mailbox-container").classList.add("hidden");
        document.getElementById("tab-btn-roles-config")?.classList.remove("hidden");
    } else {
        document.getElementById("gm-timeline-container").classList.add("hidden");
        document.getElementById("player-mailbox-container").classList.remove("hidden");
        document.getElementById("tab-btn-roles-config")?.classList.add("hidden");
    }
}

// BỘ LẬT THẺ TRÁNH RACE CONDITION
function triggerCardFlipModal(mySelf) {
    const modal = document.getElementById("flashcard-modal");
    const card = document.getElementById("fc-card");
    const pName = document.getElementById("fc-player-name");
    const rName = document.getElementById("fc-role-name");
    const rDesc = document.getElementById("fc-role-desc");

    if (!modal || !card || !pName || !rName || !rDesc) return;

    pName.innerText = mySelf.name;
    rName.innerText = getRoleName(mySelf.role);
    rDesc.innerText = `Lực lượng thuộc phe: ${ROLE_DB[mySelf.role]?.faction?.toUpperCase()}. Ghi nhớ kỹ năng tối mật của bạn và phối hợp cùng đồng đội.`;
    
    card.classList.remove("is-flipped");
    modal.style.display = "flex";

    const flipCard = () => {
        card.classList.add("is-flipped");
    };

    const closeCard = async (e) => {
        e.stopPropagation();
        modal.style.display = "none";
        card.removeEventListener("click", flipCard);
        
        // SỬA LỖI 3 & 4: Ghi đè hasSeenRole lên Firebase để không bao giờ hiển thị lại sau khi đã đóng
        try {
            await update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), {
                hasSeenRole: true
            });
        } catch (err) {
            console.error("Lỗi đồng bộ hóa trạng thái lật bài:", err);
        }
    };

    card.addEventListener("click", flipCard);
    
    const backFace = card.querySelector(".fc-back");
    if (backFace) {
        backFace.onclick = closeCard;
    }
}

// ==========================================
// 4. QUẢN LÝ LAYOUT CHUYỂN PHA ĐÊM/NGÀY & KHÓA CHAT
// ==========================================
function syncLayoutBasedOnRoleAndStatus(roomData) {
    const mySelf = Net.players[Net.playerId];
    const phase = roomData.meta?.phase || "setup";
    
    // Đóng băng toàn bộ giao diện màn hình sương mù Đêm Đen nếu không phải GM
    const sleepOverlay = document.getElementById("night-sleep-overlay");
    if (phase === "night" && !Net.isHost) {
        if (mySelf && mySelf.alive && !mySelf.turnEnded) {
            // Đến lượt hành động -> Mở mờ màn hình
            sleepOverlay.classList.add("hidden");
        } else {
            // Chưa đến lượt hoặc đã ngủ -> Che màn hình tối tuyệt đối
            sleepOverlay.classList.remove("hidden");
        }
    } else {
        sleepOverlay.classList.add("hidden");
    }

    // ĐỒNG BỘ CHAT ĐA PHE PHÁI BAN ĐÊM & ĐÓNG BĂNG KÊNH LÀNG BAN ĐÊM
    const chatInputField = document.getElementById("chat-input-field");
    const chatSendBtn = document.getElementById("btn-chat-send");

    if (phase === "night") {
        // Đêm xuống: Khóa kênh chat công khai Làng
        if (Net.currentChannel === "public") {
            if (chatInputField) {
                chatInputField.disabled = true;
                chatInputField.placeholder = "Đêm đã buông xuống, toàn làng đang ngủ say... Hãy giữ im lặng!";
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        } else {
            if (chatInputField) {
                chatInputField.disabled = false;
                chatInputField.placeholder = "Nhập tin nhắn nội bộ phe cánh...";
            }
            if (chatSendBtn) chatSendBtn.disabled = false;
        }

        // Kích hoạt hiển thị động các kênh chat phe cánh tương ứng nếu còn sống
        if (mySelf && mySelf.alive) {
            if (mySelf.role === "wolf" || mySelf.realFaction === "wolf") {
                document.getElementById("chan-wolf")?.classList.remove("hidden");
            }
            if (mySelf.inCouple && mySelf.coupleId) {
                document.getElementById("chan-couple")?.classList.remove("hidden");
            }
            if (mySelf.primeCovenantId) {
                document.getElementById("chan-prime")?.classList.remove("hidden");
            }
            if (mySelf.vampireFactionId) {
                document.getElementById("chan-vampire")?.classList.remove("hidden");
            }
            // Tử Thần faction chat
            if (mySelf.role === "reaper" || mySelf.role === "apprenticeReaper") {
                document.getElementById("chan-reaper")?.classList.remove("hidden");
            }
        }
    } else {
        // Ban ngày: Mở lại kênh chat Làng cho người sống
        if (mySelf && mySelf.alive) {
            if (mySelf.isSilencerMuted) {
                // SỬA LỖI: Bị câm lặng thì không thể nhắn tin công khai ban ngày
                if (chatInputField) {
                    chatInputField.disabled = true;
                    chatInputField.placeholder = "Bạn đang bị câm lặng (Muted) hôm nay... Im lặng!";
                }
                if (chatSendBtn) chatSendBtn.disabled = true;
            } else {
                if (chatInputField) {
                    chatInputField.disabled = false;
                    chatInputField.placeholder = "Thảo luận công khai cùng làng...";
                }
                if (chatSendBtn) chatSendBtn.disabled = false;
            }
        } else {
            // Linh hồn chỉ được chat ở kênh Graveyard
            if (Net.currentChannel === "graveyard") {
                if (chatInputField) {
                    chatInputField.disabled = false;
                    chatInputField.placeholder = "Linh hồn thảo luận ngầm...";
                }
                if (chatSendBtn) chatSendBtn.disabled = false;
            } else {
                if (chatInputField) {
                    chatInputField.disabled = true;
                    chatInputField.placeholder = "Bạn đã hy sinh, chuyển sang tab Linh Hồn để chat.";
                }
                if (chatSendBtn) chatSendBtn.disabled = true;
            }
        }

        // Đêm đã qua: Các kênh chat phe chuyển về trạng thái Chỉ đọc (Read-only)
        if (Net.currentChannel !== "public" && Net.currentChannel !== "graveyard") {
            if (chatInputField) {
                chatInputField.disabled = true;
                chatInputField.placeholder = "Kênh phe phái ban ngày chỉ đọc...";
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        }
    }

    // Hiển thị nút Cưỡng chế chuyển ngày cho Quản Trò khi đêm buông xuống
    const forceDayBtn = document.getElementById("btn-gm-force-day");
    if (Net.isHost && phase === "night") {
        forceDayBtn?.classList.remove("hidden");
    } else {
        forceDayBtn?.classList.add("hidden");
    }

    // Cập nhật Căn Cước hiển thị cố định của Người chơi
    updatePlayerIdentityCard(mySelf);

    renderDynamicActionControls(roomData, mySelf);
}

// Cập nhật widget "Thẻ Căn Cước" (Identity Widget) ở góc màn hình của Người chơi
function updatePlayerIdentityCard(mySelf) {
    const idCard = document.getElementById("player-identity-card");
    const idRoleVal = document.getElementById("id-role-val");
    const idFactionVal = document.getElementById("id-faction-val");
    const idSkillsSummary = document.getElementById("id-skills-summary");

    if (!idCard || !mySelf) return;

    if (Net.isHost) {
        // Quản trò không cần xem thẻ căn cước cá nhân
        idCard.classList.add("hidden");
        return;
    }

    idCard.classList.remove("hidden");
    idRoleVal.innerText = getRoleName(mySelf.role).toUpperCase();
    idFactionVal.innerText = mySelf.realFaction.toUpperCase();

    // Liệt kê tóm tắt mô tả kỹ năng
    const skills = ROLE_DB[mySelf.role]?.faction === "wolf" ? "Phe phái Ma Sói: Đồng tâm cắn phá vào ban đêm." : "Phe Làng: Tìm kiếm thông tin sơ hở để treo cổ Sói ban ngày.";
    idSkillsSummary.innerText = skills;
}

function updateSovereignStatusAndGuide(roomData) {
    const phase = roomData.meta.phase;
    const day = roomData.meta.day;
    const pTitle = document.getElementById("phase-title");
    const scriptText = document.getElementById("script-text");

    if (pTitle) {
        pTitle.innerText = phase === "night" ? `🌙 ĐÊM ĐEN THỨ ${day}` : `☀️ BAN NGÀY THỨ ${day}`;
    }

    if (scriptText) {
        if (phase === "night") {
            scriptText.innerText = "Đêm tối ma mị bao phủ toàn quốc... Thần dân và muông thú hãy nhắm mắt đi ngủ!";
        } else {
            scriptText.innerText = "Bình minh hé rạng! Hãy thảo luận tự do tìm kiếm dấu vết Ma Sói ẩn giấu.";
        }
    }
}

function renderDynamicActionControls(roomData, mySelf) {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel || !mySelf) return;

    const phase = roomData.meta?.phase || "setup";

    if (phase === "night") {
        if (!mySelf.alive) {
            controlPanel.innerHTML = `<p style="color:var(--log-text); font-style:italic;">Bạn đã hy sinh. Đang theo dõi ván đấu dưới dạng linh hồn...</p>`;
            return;
        }

        if (mySelf.turnEnded) {
            controlPanel.innerHTML = `<p style="color:var(--success); font-weight:bold; animation: blinker 1.5s infinite;">Đã xác nhận kết thúc lượt! Đang ngủ say chờ ngày dậy...</p>`;
            return;
        }

        const hasSkill = !PASSIVE_NIGHT_ROLES_CHECK(mySelf.role);
        const rIcon = ROLE_ICONS[mySelf.role] || "🔮";

        let buttonHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                ${hasSkill ? `<button id="btn-use-skill" class="btn-accent w-100">${rIcon} KÍCH HOẠT KỸ NĂNG ĐÊM</button>` : `<p style="color:var(--log-text);">Bạn là Dân Làng thụ động. Hãy yên lặng đi ngủ.</p>`}
                <button id="btn-end-turn" class="btn-success w-100">💤 XÁC NHẬN KẾT THÚC LƯỢT</button>
            </div>
        `;

        controlPanel.innerHTML = buttonHTML;

        document.getElementById("btn-use-skill")?.addEventListener("click", () => {
            openTargetSelection(Object.values(Net.players), mySelf.role, (targetPlayerId, secondaryId, chosenModifier, phrase) => {
                set(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/targetSelection`), {
                    actionType: chosenModifier || (mySelf.role + "_action"), 
                    targetId: targetPlayerId,
                    secondaryId: secondaryId,
                    phrase: phrase,
                    timestamp: Date.now()
                });
                showToast("Đã ghi nhận mục tiêu hành động đêm của bạn!", "success");
            });
        });

        document.getElementById("btn-end-turn")?.addEventListener("click", async () => {
            try {
                await update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), {
                    turnEnded: true
                });
            } catch (err) {
                console.error("Lỗi xác nhận kết thúc lượt:", err);
            }
        });

    } else if (phase === "day") {
        controlPanel.innerHTML = `
            <div style="display:flex; gap:10px; width:100%;">
                <button id="btn-nominate-vote" class="btn-danger w-100">⚖️ ĐỀ CỬ LÊN ĐÀI BIỆN HỘ</button>
            </div>
        `;

        document.getElementById("btn-nominate-vote")?.addEventListener("click", () => {
            openTargetSelection(Object.values(Net.players), "nominate", (targetId) => {
                window.Engine_Module.accusePlayer(targetId);
            });
        });
    }
}

function PASSIVE_NIGHT_ROLES_CHECK(role) {
    return ["villager", "clown", "idiot", "ghost", "halfWolf", "apprenticeSeer", "doppelganger"].includes(role);
}

// ==========================================
// 5. ĐỒNG BỘ TIẾN TRÌNH BIỂU QUYẾT TREO CỔ (TRIAL STAGE)
// ==========================================
function syncTrialPhases(roomData) {
    const trial = roomData.trial || { stage: "none", accusedId: null };
    const stageContainer = document.getElementById("trial-stage-container");

    const steps = ["step-ind-1", "step-ind-2", "step-ind-3", "step-ind-4"];
    steps.forEach(st => document.getElementById(st)?.classList.remove("active"));

    if (trial.stage === "none") {
        stageContainer.classList.add("hidden");
        document.getElementById("vote-modal").style.display = "none";
        document.getElementById("trial-vote-progress-wrapper")?.classList.add("hidden");
        return;
    }

    stageContainer.classList.remove("hidden");

    if (trial.stage === "nomination") {
        document.getElementById("step-ind-1").classList.add("active");
    }

    if (trial.stage === "defense") {
        document.getElementById("step-ind-2").classList.add("active");
        const accusedName = Net.players[trial.accusedId]?.name || "Bị cáo";
        
        if (Net.playerId === trial.accusedId) {
            renderDefenseTypingPanel(true);
        } else {
            renderDefenseTypingPanel(false, accusedName);
        }
    }

    if (trial.stage === "vote") {
        document.getElementById("step-ind-3").classList.add("active");
        openSplitScreenVoteModal(trial.accusedId, roomData);
    }

    if (trial.stage === "verdict") {
        document.getElementById("step-ind-4").classList.add("active");
        document.getElementById("vote-modal").style.display = "none";
    }
}

function renderDefenseTypingPanel(isAccused, accusedName = "") {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel) return;

    if (isAccused) {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; border:2px solid var(--accent)">
                <textarea id="defense-typing-area" placeholder="Nhập lời biện hộ cứu rỗi bản thân của bạn tại đây..." style="width:100%; height:80px; background:var(--bg-main); color:white; border-radius:6px; padding:8px; border:1px solid var(--border-color);"></textarea>
                <button id="btn-submit-defense-speech" class="btn-success w-100" style="margin-top:10px;">Gửi Lời Biện Hộ</button>
            </div>
        `;
        
        const area = document.getElementById("defense-typing-area");
        area.addEventListener("input", () => {
            update(ref(db, `rooms/${Net.roomId}/trial`), {
                accusedText: area.value
            });
        });

        document.getElementById("btn-submit-defense-speech")?.addEventListener("click", () => {
            update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "vote"
            });
        });
    } else {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; text-align:left; min-height:80px; border-left:4px solid var(--accent);">
                <p id="defense-realtime-display" style="font-style:italic; margin:0; color:var(--accent);">Bị cáo đang soạn thảo lời bào chữa...</p>
            </div>
        `;
        
        const textRef = ref(db, `rooms/${Net.roomId}/trial/accusedText`);
        onValue(textRef, (snap) => {
            const txt = snap.val() || "...";
            const display = document.getElementById("defense-realtime-display");
            if (display) display.innerText = `"${txt}"`;
        });
    }
}

function openSplitScreenVoteModal(accusedId, roomData) {
    const modal = document.getElementById("vote-modal");
    if (!modal) return;
    modal.style.display = "flex";

    const title = document.getElementById("vote-modal-title");
    title.innerText = `PHÁN QUYẾT SỐ PHẬN: ${Net.players[accusedId]?.name?.toUpperCase()}`;

    const listAcquit = document.getElementById("list-voters-acquit");
    const listExecute = document.getElementById("list-voters-execute");
    listAcquit.innerHTML = "";
    listExecute.innerHTML = "";

    const votes = roomData.votes || {};
    let countAcquit = 0;
    let countExecute = 0;

    Object.entries(votes).forEach(([voterId, voteValue]) => {
        const voterName = Net.players[voterId]?.name || "Thành viên";
        const chip = document.createElement("div");
        chip.className = "voter-avatar-chip";
        chip.innerText = voterName;

        if (voteValue === "ACQUIT") {
            countAcquit++;
            listAcquit.appendChild(chip);
        } else if (voteValue === "EXECUTE") {
            countExecute++;
            listExecute.appendChild(chip);
        }
    });

    document.getElementById("count-acquit").innerText = countAcquit;
    document.getElementById("count-execute").innerText = countExecute;

    // Cập nhật thanh tiến trình biểu quyết treo cổ (UX Progress Bar Indicator)
    const progressWrapper = document.getElementById("trial-vote-progress-wrapper");
    const progressFill = document.getElementById("trial-vote-progress-fill");
    const progressRatio = document.getElementById("trial-vote-ratio");

    if (progressWrapper && progressFill && progressRatio) {
        progressWrapper.classList.remove("hidden");
        const totalVotes = countAcquit + countExecute;
        const totalAlive = window.G.players.filter(p => p.alive).length;
        
        progressRatio.innerText = `${totalVotes}/${totalAlive}`;
        const pct = totalAlive > 0 ? (totalVotes / totalAlive) * 100 : 0;
        progressFill.style.width = `${pct}%`;
    }

    document.getElementById("btn-vote-acquit").onclick = () => {
        set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "ACQUIT");
    };

    document.getElementById("btn-vote-execute").onclick = () => {
        set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "EXECUTE");
    };

    // GM tự kiểm duyệt phán quyết khi đủ đa số phiếu
    if (Net.isHost) {
        const totalVotes = countAcquit + countExecute;
        const totalAlive = window.G.players.filter(p => p.alive).length;
        if (totalVotes >= totalAlive) {
            StateMachine.resolveVotingOutcome();
        }
    }
}

// Hoạt ảnh búa phán quyết của tòa án
export function runGavelStrikeAnimation(decisionText, callback) {
    const overlay = document.getElementById("gavel-animation-overlay");
    const flash = document.getElementById("gavel-flash-element");
    const announcement = document.getElementById("gavel-verdict-announcement");

    if (!overlay) return;

    announcement.innerText = decisionText;
    overlay.classList.remove("hidden");

    setTimeout(() => {
        if (flash) flash.classList.add("flash-active");
    }, 500);

    setTimeout(() => {
        overlay.classList.add("hidden");
        if (flash) flash.classList.remove("flash-active");
        if (callback) callback();
    }, 2500);
}

// ==========================================
// 6. HỘP THƯ MAILBOX & THẢO LUẬN MẬT THƯ PARCHMENT
// ==========================================
function renderMailbox(mails) {
    const container = document.getElementById("mailbox-list");
    if (!container) return;
    container.innerHTML = "";

    const mailArray = Object.entries(mails).map(([id, data]) => ({ id, ...data }));
    mailArray.sort((a, b) => b.timestamp - a.timestamp);

    // Đồng bộ số lượng thư chưa đọc lên Badge tab mobile
    const unreadCount = mailArray.filter(m => !m.isRead).length;
    const badge = document.getElementById("mail-badge");
    if (badge) {
        if (unreadCount > 0) {
            badge.innerText = unreadCount;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    }

    const filteredMails = mailArray.filter(m => {
        if (Net.mailCategory === "all") return true;
        return m.category === Net.mailCategory;
    });

    // Lưu trữ danh sách thư lọc hiện tại phục vụ điều hướng Parchment
    openedMailsList = filteredMails;

    if (filteredMails.length === 0) {
        container.innerHTML = `<p class="empty-mailbox-hint" style="text-align: center; font-size:13px; opacity:0.5; margin-top:20px;">Hòm thư trống</p>`;
        return;
    }

    filteredMails.forEach((mail, idx) => {
        const card = document.createElement("div");
        card.className = `mail-card ${mail.isRead ? "read" : "unread"}`;
        
        const title = document.createElement("div");
        title.className = "mail-title";
        title.innerText = mail.title;

        const summary = document.createElement("div");
        summary.className = "mail-summary";
        summary.innerText = mail.content;

        const indicator = document.createElement("div");
        indicator.className = "mail-indicator";
        indicator.innerText = mail.isRead ? "✓" : "!";

        card.appendChild(title);
        card.appendChild(summary);
        card.appendChild(indicator);

        card.addEventListener("click", () => {
            currentMailIndex = idx;
            openParchmentMail(mail);
        });
        container.appendChild(card);
    });
}

function openParchmentMail(mail) {
    const modal = document.getElementById("mailbox-parchment-modal");
    const pTitle = document.getElementById("parchment-mail-title");
    const pText = document.getElementById("parchment-mail-text");

    if (!modal || !pTitle || !pText) return;

    pTitle.innerText = mail.title;
    pText.innerText = mail.content;
    modal.style.display = "flex";

    // Đánh dấu đã đọc mượt mà lên Firebase
    update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${mail.id}`), {
        isRead: true
    });

    document.getElementById("btn-close-parchment").onclick = () => {
        modal.style.display = "none";
    };
}

// Thiết lập điều hướng nhanh bằng các nút "Thư trước / Thư sau" trong Parchment Modal
function setupParchmentNavigation() {
    const btnPrev = document.getElementById("btn-prev-parchment");
    const btnNext = document.getElementById("btn-next-parchment");

    if (!btnPrev || !btnNext) return;

    btnPrev.addEventListener("click", () => {
        if (currentMailIndex > 0) {
            currentMailIndex--;
            const prevMail = openedMailsList[currentMailIndex];
            openParchmentMail(prevMail);
        } else {
            showToast("Đây là mật thư đầu tiên!", "info");
        }
    });

    btnNext.addEventListener("click", () => {
        if (currentMailIndex < openedMailsList.length - 1) {
            currentMailIndex++;
            const nextMail = openedMailsList[currentMailIndex];
            openParchmentMail(nextMail);
        } else {
            showToast("Đây là mật thư cuối cùng!", "info");
        }
    });
}

function setupMailboxCategoryFilters() {
    const tabs = document.querySelectorAll(".mail-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            Net.mailCategory = tab.getAttribute("data-category");
            
            get(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`)).then((snap) => {
                renderMailbox(snap.val() || {});
            });
        });
    });

    document.getElementById("btn-mail-read-all")?.addEventListener("click", async () => {
        const mailboxRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`);
        try {
            const snap = await get(mailboxRef);
            if (snap.exists()) {
                const mails = snap.val();
                const updates = {};
                Object.keys(mails).forEach(id => {
                    updates[`rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${id}/isRead`] = true;
                });
                await update(ref(db), updates);
                showToast("Đã đánh dấu đã đọc toàn bộ mật thư!", "success");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

// ==========================================
// 7. KHÁN GIẢ & KÊNH CHAT BẢO MẬT ĐÊM
// ==========================================
function setupChatEngine() {
    const btnSend = document.getElementById("btn-chat-send");
    const input = document.getElementById("chat-input-field");

    if (btnSend && input) {
        btnSend.addEventListener("click", sendChatMessage);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") sendChatMessage();
        });
    }

    // Luồng lắng nghe sự kiện tab chuyển kênh chat động
    const channels = ["chan-public", "chan-wolf", "chan-couple", "chan-prime", "chan-vampire", "chan-reaper", "chan-graveyard"];
    channels.forEach(ch => {
        document.getElementById(ch)?.addEventListener("click", (e) => {
            channels.forEach(c => document.getElementById(c)?.classList.remove("active"));
            e.target.classList.add("active");
            
            const chanName = ch.replace("chan-", "");
            Net.currentChannel = chanName;

            // ĐỒNG BỘ AN TOÀN CHAT KEY chống đọc trộm qua F12 Console
            let mappedFirebasePath = chanName;
            const mySelf = Net.players[Net.playerId];

            if (chanName === "couple" && mySelf && mySelf.coupleId) {
                mappedFirebasePath = mySelf.coupleId; // Lắng nghe đường dẫn hash riêng
            } else if (chanName === "prime" && mySelf && mySelf.primeCovenantId) {
                mappedFirebasePath = mySelf.primeCovenantId;
            } else if (chanName === "vampire" && mySelf && mySelf.vampireFactionId) {
                mappedFirebasePath = mySelf.vampireFactionId;
            } else if (chanName === "reaper" && mySelf && mySelf.reaperFactionId) {
                mappedFirebasePath = mySelf.reaperFactionId;
            }

            listenToChatChannel(mappedFirebasePath);
        });
    });
}

async function sendChatMessage() {
    const input = document.getElementById("chat-input-field");
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    // ĐỒNG BỘ AN TOÀN CHAT KEY khi gửi lên DB
    let mappedFirebasePath = Net.currentChannel;
    const mySelf = Net.players[Net.playerId];

    if (Net.currentChannel === "couple" && mySelf && mySelf.coupleId) {
        mappedFirebasePath = mySelf.coupleId;
    } else if (Net.currentChannel === "prime" && mySelf && mySelf.primeCovenantId) {
        mappedFirebasePath = mySelf.primeCovenantId;
    } else if (Net.currentChannel === "vampire" && mySelf && mySelf.vampireFactionId) {
        mappedFirebasePath = mySelf.vampireFactionId;
    } else if (Net.currentChannel === "reaper" && mySelf && mySelf.reaperFactionId) {
        mappedFirebasePath = mySelf.reaperFactionId;
    }

    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${mappedFirebasePath}`);
    const messagePayload = {
        senderName: Net.playerName,
        senderId: Net.playerId,
        text: msg,
        timestamp: Date.now()
    };

    try {
        await push(chatRef, messagePayload);
        input.value = "";
    } catch (err) {
        console.error("Lỗi gửi chat:", err);
    }
}

function listenToChatChannel(channelPath) {
    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${channelPath}`);
    onValue(chatRef, (snap) => {
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;
        chatBox.innerHTML = "";

        const messages = snap.val() || {};
        Object.values(messages).forEach(m => {
            const row = document.createElement("div");
            row.className = `chat-msg ${Net.currentChannel}`;
            row.innerHTML = `<b style="color:var(--accent)">${m.senderName}:</b> ${m.text}`;
            chatBox.appendChild(row);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function setupSpectatorWinPoll() {
    const buttons = [
        { id: "pred-bar-village", faction: "village" },
        { id: "pred-bar-wolf", faction: "wolf" },
        { id: "pred-bar-third", faction: "third" }
    ];

    buttons.forEach(btn => {
        document.getElementById(btn.id)?.addEventListener("click", async () => {
            const mySelf = Net.players[Net.playerId];
            if (mySelf && mySelf.alive) {
                showToast("Bạn vẫn đang sống, hãy tập trung thảo luận!", "warning");
                return;
            }
            await set(ref(db, `rooms/${Net.roomId}/prediction_poll/${Net.playerId}`), btn.faction);
        });
    });

    onValue(ref(db, `rooms/${Net.roomId}/prediction_poll`), (snap) => {
        const polls = snap.val() || {};
        const total = Object.keys(polls).length || 1;
        let counts = { village: 0, wolf: 0, third: 0 };
        
        Object.values(polls).forEach(fac => counts[fac]++);

        const vilPct = Math.round((counts.village / total) * 100);
        const wolfPct = Math.round((counts.wolf / total) * 100);
        const thirdPct = Math.round((counts.third / total) * 100);

        document.getElementById("pred-bar-village").style.width = `${vilPct}%`;
        document.getElementById("pred-pct-village").innerText = `${vilPct}%`;

        document.getElementById("pred-bar-wolf").style.width = `${wolfPct}%`;
        document.getElementById("pred-pct-wolf").innerText = `${wolfPct}%`;

        document.getElementById("pred-bar-third").style.width = `${thirdPct}%`;
        document.getElementById("pred-pct-third").innerText = `${thirdPct}%`;
    });
}

// ==========================================
// 8. KHU VỰC HIỂN THỊ LƯỚI GRID NGƯỜI CHƠI
// ==========================================
function applyDecorativeClasses(p, card) {
    if (p.isSeerScanned) card.classList.add("seer-scanned");
    if (p.isProtected) card.classList.add("guard-protected");
    if (p.isGuardBlocked) card.classList.add("guard-blocked");
    if (p.isWitchHealed) card.classList.add("witch-healed");
    if (p.isWitchPoisoned) card.classList.add("witch-poisoned");
    if (p.isHunterMarked) card.classList.add("hunter-marked");
    if (p.isCupidLinked) card.classList.add("cupid-linked");
    if (p.isAngelPurified) card.classList.add("angel-purified");
    if (p.isCarverBlacklisted) card.classList.add("carver-blacklisted");
    if (p.isGuarantorSealed) card.classList.add("guarantor-sealed");
    if (p.isReflectorMirrored) card.classList.add("reflector-mirrored");
    if (p.isAvengerAsleep) card.classList.add("avenger-asleep");
    if (p.isAvengerExecuted) card.classList.add("avenger-executed");
    if (p.isWolfTargeted) card.classList.add("wolf-targeted");
    if (p.isSnowWolfFrozen) card.classList.add("snowwolf-frozen");
    if (p.isWolfMageScanned) card.classList.add("wolfmage-scanned");
    if (p.isPhantomSwapped) card.classList.add("phantom-swapped");
    if (p.isSilencerMuted) card.classList.add("silencer-muted");
    if (p.isSolitaireCursed) card.classList.add("solitaire-cursed");
    if (p.isDemonHellfire) card.classList.add("demon-hellfire");
    if (p.isMissionaryConverted) card.classList.add("missionary-converted");
    if (p.isVampireBitten) card.classList.add("vampire-bitten");
    if (p.isArsonistPetroled) card.classList.add("arsonist-petroled");
    if (p.isArsonistIgnited) card.classList.add("arsonist-ignited");
    if (p.isEradicatorTrapped) card.classList.add("eradicator-trapped");
    if (p.isManipulatorManipulated) card.classList.add("manipulator-manipulated");
    if (p.isLethalSlashed) card.classList.add("lethal-slashed");
    if (p.isReaperPredicted) card.classList.add("reaper-predicted");
    if (p.isPrimeNebula) card.classList.add("prime-nebula");
    if (p.isCatClawed) card.classList.add("cat-clawed");
    if (p.isCatSealed) card.classList.add("cat-sealed");
    if (p.isReaperCorpse) card.classList.add("reaper-corpse");

    if (p.wolfVotesCount && p.wolfVotesCount > 0) {
        const badge = document.createElement("span");
        badge.className = "wolf-votes";
        badge.innerText = `🐺 x${p.wolfVotesCount}`;
        card.appendChild(badge);
    }
}

// SỬA LỖI 1: GM nhìn thấy vai trò của tất cả người chơi ngay dưới tên ở Grid chính suốt trận đấu
function renderUnmaskedSpectatorGrid() {
    const grid = document.getElementById("game-players-grid");
    if (!grid) return;
    grid.innerHTML = "";

    Object.values(Net.players).forEach(p => {
        const card = document.createElement("div");
        card.className = `player-grid-card ${p.alive ? "" : "dead"}`;
        
        const dot = document.createElement("span");
        dot.className = `status-dot ${p.isConnected ? "online" : "offline"}`;
        
        const name = document.createElement("span");
        name.className = "name";
        name.innerText = p.name;

        const roleUnmasked = document.createElement("span");
        roleUnmasked.className = "role-unmasked";
        roleUnmasked.innerText = `[${getRoleName(p.role)}]`;
        
        card.appendChild(dot);
        card.appendChild(name);
        card.appendChild(roleUnmasked);

        applyDecorativeClasses(p, card);

        card.addEventListener("click", () => {
            showPlayerBottomSheet(p, Net.isHost);
        });

        grid.appendChild(card);
    });
}

function renderNormalPlayerGrid() {
    const grid = document.getElementById("game-players-grid");
    if (!grid) return;
    grid.innerHTML = "";

    Object.values(Net.players).forEach(p => {
        const card = document.createElement("div");
        card.className = `player-grid-card ${p.alive ? "" : "dead"}`;
        
        const dot = document.createElement("span");
        dot.className = `status-dot ${p.isConnected ? "online" : "offline"}`;
        
        const name = document.createElement("span");
        name.className = "name";
        name.innerText = p.name;

        card.appendChild(dot);
        card.appendChild(name);

        applyDecorativeClasses(p, card);

        card.addEventListener("click", () => {
            showPlayerBottomSheet(p, Net.isHost);
        });

        grid.appendChild(card);
    });
}

function renderGMLogs(logs) {
    const logBox = document.getElementById("gm-timeline-log");
    if (!logBox) return;
    logBox.innerHTML = "";

    const logArray = Object.values(logs);
    logArray.sort((a, b) => b.timestamp - a.timestamp);

    logArray.forEach(l => {
        const item = document.createElement("div");
        item.className = "log-item";
        item.innerHTML = `<span class="sys-msg">[Ngày ${l.day} - ${l.phase.toUpperCase()}]</span> <span class="${l.type}-msg">${l.msg}</span>`;
        logBox.appendChild(item);
    });
}

// ==========================================
// 9. CÁC TIỆN ÍCH KHÁC
// ==========================================
function copyRoomId() {
    if (!Net.roomId) return;
    navigator.clipboard.writeText(Net.roomId).then(() => {
        showToast("Đã sao chép mã phòng vào khay nhớ tạm!", "success");
    });
}

function updateBalanceAndCountsUI() {
    if (!window.G) return;
    
    // Đồng bộ chỉ số GM cấu hình
    const totalRoleAllocated = Object.values(window.G.roleCounts).reduce((a, b) => a + b, 0);
    const roleCountEl = document.getElementById("role-count");
    const totalEl = document.getElementById("role-player-total");
    if (roleCountEl) roleCountEl.innerText = totalRoleAllocated;
    if (totalEl) totalEl.innerText = window.G.players.length;

    // Cập nhật thống kê số người chơi tab Board chính
    const pCountDisp = document.getElementById('player-count-display');
    if (pCountDisp) pCountDisp.innerText = window.G.players.length;

    window.UI_Module.updateBalanceUI();
    window.UI_Module.updateActiveRolesSummary();
}