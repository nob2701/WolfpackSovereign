/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - MAIN ORCHESTRATOR & NETWORK SYNC MODULE (UPDATE 8 FULL)
 * =========================================================================
 * Tệp điều phối trung tâm ứng dụng. Quản lý kết nối Firebase Realtime,
 * Sảnh chờ Lobby, Mật khẩu phòng, Chuyển giao Host tự động, Render Bàn Cờ,
 * Kênh Thảo Luận Multi-Channel, GM Whispers, Export Logs và Anti-Memory Leak.
 */

import { 
    db, ref, set, get, onValue, update, push, onDisconnect, 
    verifyRoomPassword, getSynchronizedTimestamp 
} from "./firebase-config.js";
import { StateMachine } from "./state-machine.js";
import { 
    openTargetSelection, ModalManager, initMobileTabSync, showPlayerBottomSheet, 
    setupSoundSettings, showToast, askConfirm, openMayorSuccessionModal,
    NavigationStack, openHunterRevengeModal, debounceButton 
} from "./ui-manager.js";
import { 
    ROLE_DB, ROLE_ICONS, FACTION_ICONS, getRoleName, PASSIVE_ROLES, ACTIVE_NIGHT_ROLES,
    checkMajorityNominationTrigger, Engine_Module 
} from "./game-logic.js";

// Trạng thái mạng và đồng bộ cục bộ của Client
export const Net = {
    roomId: null,
    playerId: null,
    playerName: "",
    isHost: false,
    players: {}, 
    connectedRef: null,
    currentChannel: "public",
    mailCategory: "all",
    isReconnecting: false
};
window.Net = Net;

// Quản lý dọn dẹp bộ nhớ các Listener Realtime Database
let activeUnsubscribers = [];
let activeChatUnsub = null; 
let activeDefenseUnsub = null;
let activeGMWhisperUnsub = null;
let presenceConfigured = false; 
let spectatorPollConfigured = false;
let openedMailsList = [];
let currentMailIndex = -1;

// KHỞI CHẠY ỨNG DỤNG AN TOÀN (BẢO VỆ CHỐNG BẪY DOMCONTENTLOADED CỦA ES6 MODULES)
function initApp() {
    try {
        initLobbyEngine();
        setupCodeInputNavigation();
        initMobileTabSync();
        setupSoundSettings();
        setupChatEngine();
        setupParchmentNavigation();
        setupGMConsoleListeners();
    } catch (err) {
        console.warn("⚠️ [Khởi tạo App] Cảnh báo DOM:", err);
    } finally {
        dismissSplashScreen();
        attemptSessionReconnection();
    }
}

// Kiểm tra nếu DOM đã tải xong trước khi Module import hoàn tất
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

// Giải phóng màn hình chờ Splash Screen An Toàn
function dismissSplashScreen() {
    const splash = document.getElementById("splash-screen");
    if (!splash) return;

    const hideSplash = () => {
        splash.classList.add("hidden");
        splash.style.display = "none";
    };

    splash.addEventListener("click", hideSplash);
    setTimeout(hideSplash, 1000);
}

// Giải phóng bộ nhớ của toàn bộ các Listener cũ
function clearActiveListeners() {
    activeUnsubscribers.forEach(unsub => {
        if (typeof unsub === "function") unsub();
    });
    activeUnsubscribers = [];

    if (activeChatUnsub) {
        activeChatUnsub();
        activeChatUnsub = null;
    }

    if (activeDefenseUnsub) {
        activeDefenseUnsub();
        activeDefenseUnsub = null;
    }

    if (activeGMWhisperUnsub) {
        activeGMWhisperUnsub();
        activeGMWhisperUnsub = null;
    }
    
    presenceConfigured = false;
    spectatorPollConfigured = false;
}

// ==========================================
// 1. ĐĂNG NHẬP VÀ TẠO / THAM GIA PHÒNG CHƠI
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
    const btnLeaveRoom = document.getElementById("btn-leave-room");
    const btnHeaderBackLobby = document.getElementById("btn-header-back-lobby");

    if (nameInput) {
        nameInput.addEventListener("input", () => {
            const cleanName = nameInput.value.trim().replace(/[^a-zA-Z0-9\sÀ-ỹ]/g, "").substring(0, 10);
            nameInput.value = cleanName;
            const isValid = cleanName.length >= 2 && cleanName.length <= 10;
            if (btnInitialJoin) btnInitialJoin.disabled = !isValid;
            if (btnCreate) btnCreate.disabled = !isValid;
            Net.playerName = cleanName;
        });
    }

    // Tự động điền tên cũ từ LocalStorage và PHÁT SỰ KIỆN INPUT chủ động để mở khóa nút bấm
    const savedName = localStorage.getItem("online_player_name");
    if (savedName && nameInput) {
        const truncatedName = savedName.substring(0, 10);
        nameInput.value = truncatedName;
        Net.playerName = truncatedName;
        nameInput.dispatchEvent(new Event("input"));
    }

    if (btnInitialJoin) {
        btnInitialJoin.addEventListener("click", () => {
            if (debounceButton(btnInitialJoin, 300) || Net.isReconnecting) return;
            localStorage.setItem("online_player_name", Net.playerName);
            document.getElementById("login-form-panel")?.classList.add("hidden");
            document.getElementById("join-code-panel")?.classList.remove("hidden");
            NavigationStack.push("join-code-panel");
        });
    }

    if (btnBackToLogin) {
        btnBackToLogin.addEventListener("click", () => {
            document.getElementById("join-code-panel")?.classList.add("hidden");
            document.getElementById("login-form-panel")?.classList.remove("hidden");
            NavigationStack.pop();
        });
    }

    if (btnCreate) btnCreate.addEventListener("click", () => {
        if (debounceButton(btnCreate, 500) || Net.isReconnecting) return;
        createRoom();
    });

    if (btnJoinSubmit) btnJoinSubmit.addEventListener("click", () => {
        if (debounceButton(btnJoinSubmit, 500) || Net.isReconnecting) return;
        let code = "";
        for (let i = 1; i <= 6; i++) {
            const el = document.getElementById(`code-${i}`);
            if (el) code += el.value;
        }
        const pwdInput = document.getElementById("join-room-password");
        const passwordVal = pwdInput ? pwdInput.value : "";

        if (code.length === 6) {
            joinRoom(code.toUpperCase(), passwordVal);
        }
    });

    if (btnLeaveRoom) {
        btnLeaveRoom.addEventListener("click", () => {
            if (debounceButton(btnLeaveRoom, 500)) return;
            const confirmMsg = Net.isHost 
                ? "Bạn có chắc chắn muốn HỦY PHÒNG này? Quyền Quản trò sẽ chuyển giao hoặc phòng bị giải tán."
                : "Bạn có chắc chắn muốn RỜI KHỎI PHÒNG này?";
            askConfirm(confirmMsg, async () => {
                await handleRoomExit();
            });
        });
    }

    if (btnHeaderBackLobby) {
        btnHeaderBackLobby.addEventListener("click", () => {
            askConfirm("Bạn muốn thoát khỏi bàn cờ và quay về sảnh chờ?", async () => {
                await handleRoomExit();
            });
        });
    }

    if (btnCopyRoom) btnCopyRoom.addEventListener("click", copyRoomId);
    if (btnToggleReady) btnToggleReady.addEventListener("click", toggleReadyState);
    if (btnHostStartSetup) btnHostStartSetup.addEventListener("click", hostStartSetup);
}

function setupGMConsoleListeners() {
    document.getElementById("btn-gm-trigger-mayor")?.addEventListener("click", () => {
        askConfirm("Kích hoạt cuộc bầu chọn Trưởng Làng ngay bây giờ?", () => {
            StateMachine.startMayorElection();
        });
    });

    document.getElementById("btn-gm-force-day")?.addEventListener("click", () => {
        askConfirm("Cưỡng chế chuyển sang BAN NGÀY lập tức? Mọi hành động đêm chưa chọn sẽ bị bỏ qua!", () => {
            StateMachine.forceTransitionToDay();
        });
    });

    document.getElementById("btn-gm-resolve-vote")?.addEventListener("click", () => {
        askConfirm("Chốt kết quả bỏ phiếu xử án treo cổ ngay lập tức?", () => {
            StateMachine.resolveVotingOutcome();
        });
    });

    document.getElementById("btn-gm-add-time")?.addEventListener("click", async () => {
        if (!Net.isHost) return;
        const metaRef = ref(db, `rooms/${Net.roomId}/meta`);
        const snap = await get(metaRef);
        if (snap.exists()) {
            const meta = snap.val();
            const newEndTime = (meta.timerEndTime || getSynchronizedTimestamp()) + 15000;
            await update(metaRef, { timerEndTime: newEndTime });
            showToast("Đã cộng thêm 15 giây vào đồng hồ pha!", "success");
        }
    });

    // Nút Tải Xuất Match Logs cho GM
    document.getElementById("btn-export-logs")?.addEventListener("click", () => {
        window.UI_Module.exportMatchLogs();
    });
}

// SỬA LỖI NHẬP MÃ PHÒNG VÀ ĐIỀU HƯỚNG BÀN PHÍM ẢO DI ĐỘNG (iOS/ANDROID BACKSPACE)
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

        // Bắt phím Xóa (Backspace) trên bàn phím cứng lẫn bàn phím ảo di động
        const handleBackspace = (e) => {
            if (e.key === "Backspace" || e.code === "Backspace") {
                if (!input.value && index > 0) {
                    inputs[index - 1].focus();
                }
            }
        };

        input.addEventListener("keydown", handleBackspace);
        input.addEventListener("keyup", (e) => {
            if ((e.key === "Backspace" || e.code === "Backspace") && !input.value && index > 0) {
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
// 2. KẾT NỐI TẠO PHÒNG VÀ XÁC THỰC MẬT KHẨU
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
    if (Net.playerName.length < 2 || Net.isReconnecting) return;
    const roomId = generateRoomCode();
    Net.roomId = roomId;
    Net.playerId = "host_" + Date.now();
    Net.isHost = true;

    localStorage.setItem("reconnect_room_id", roomId);
    localStorage.setItem("reconnect_player_id", Net.playerId);

    const pwdInput = document.getElementById("cfg-room-password");
    const roomPassword = pwdInput ? pwdInput.value.trim() : "";

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
        hasSeenRole: false,
        joinedTime: getSynchronizedTimestamp()
    };

    const initialRoomState = {
        meta: {
            hostId: Net.playerId,
            roomId: roomId,
            password: roomPassword,
            phase: "setup",
            day: 0,
            started: false,
            createdTime: getSynchronizedTimestamp()
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
        showToast(`Tạo phòng ${roomId} thành công!`, "success");
    } catch (error) {
        showToast("Lỗi khi khởi tạo phòng trực tuyến!", "danger");
    }
}

async function joinRoom(roomId, passwordInput = "", name = Net.playerName) {
    if (Net.isReconnecting) return;

    // Kiểm tra mật khẩu phòng thông qua Helper
    const pwdCheck = await verifyRoomPassword(roomId, passwordInput);
    if (!pwdCheck.valid) {
        showToast(pwdCheck.reason || "Mật khẩu phòng chơi không chính xác!", "danger");
        return;
    }

    const roomRef = ref(db, `rooms/${roomId}`);
    try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            showToast("Mã phòng không tồn tại!", "danger");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.meta.started) {
            showToast("Ván đấu đã bắt đầu, không thể tham gia!", "danger");
            return;
        }

        Net.roomId = roomId;
        Net.playerId = "player_" + Date.now();
        Net.isHost = false;

        localStorage.setItem("reconnect_room_id", roomId);
        localStorage.setItem("reconnect_player_id", Net.playerId);

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
            hasSeenRole: false,
            joinedTime: getSynchronizedTimestamp()
        };

        await set(playerRef, playerData);
        enterLobbyMode();
        listenToRoom();
        showToast(`Đã tham gia phòng ${roomId}!`, "success");
    } catch (error) {
        showToast("Gặp sự cố khi gia nhập phòng!", "danger");
    }
}

function enterLobbyMode() {
    document.getElementById("login-form-panel")?.classList.add("hidden");
    document.getElementById("join-code-panel")?.classList.add("hidden");
    document.getElementById("lobby-room-status")?.classList.remove("hidden");
    
    const displayCode = document.getElementById("current-room-display");
    if (displayCode) displayCode.innerText = Net.roomId;

    const hostCtrl = document.getElementById("lobby-host-controls");
    const playerCtrl = document.getElementById("lobby-player-controls");
    const waitingMsg = document.getElementById("lobby-waiting-msg");

    if (Net.isHost) {
        hostCtrl?.classList.remove("hidden");
        playerCtrl?.classList.add("hidden");
        waitingMsg?.classList.add("hidden");
    } else {
        hostCtrl?.classList.add("hidden");
        playerCtrl?.classList.remove("hidden");
        waitingMsg?.classList.remove("hidden");
    }
}

function setupActivePlayersPresence() {
    if (presenceConfigured || !Net.roomId || !Net.playerId) return;
    presenceConfigured = true;

    const connectionRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isConnected`);
    set(connectionRef, true);
    onDisconnect(connectionRef).set(false);
}

// KHÔI PHỤC PHIÊN CHƠI VỚI CỜ LÓC CHỐNG ĐUA TRẠNG THÁI (RECONNECT RACE CONDITION GUARD)
async function attemptSessionReconnection() {
    const savedRoomId = localStorage.getItem("reconnect_room_id");
    const savedPlayerId = localStorage.getItem("reconnect_player_id");

    if (savedRoomId && savedPlayerId) {
        Net.isReconnecting = true;
        const overlay = document.getElementById("reconnect-overlay");
        if (overlay) overlay.style.display = "flex";

        const safeTimeout = setTimeout(() => {
            if (overlay) overlay.style.display = "none";
            Net.isReconnecting = false;
        }, 2000);

        try {
            const roomRef = ref(db, `rooms/${savedRoomId}`);
            const snapshot = await get(roomRef);

            if (snapshot.exists()) {
                const roomData = snapshot.val();
                if (roomData.players && roomData.players[savedPlayerId]) {
                    Net.roomId = savedRoomId;
                    Net.playerId = savedPlayerId;
                    Net.playerName = roomData.players[savedPlayerId].name;
                    Net.isHost = roomData.players[savedPlayerId].isHost;

                    enterLobbyMode();
                    
                    if (roomData.meta.phase !== "setup" || roomData.meta.started) {
                        transitionToGameScreen(roomData);
                    }
                    
                    listenToRoom();
                    showToast("Khôi phục phiên kết nối thành công!", "success");
                } else {
                    cleanSessionStorage();
                }
            } else {
                cleanSessionStorage();
            }
        } catch (err) {
            console.error("Lỗi phục hồi kết nối tự động:", err);
            cleanSessionStorage();
        } finally {
            clearTimeout(safeTimeout);
            if (overlay) overlay.style.display = "none";
            Net.isReconnecting = false;
        }
    }
}

function cleanSessionStorage() {
    localStorage.removeItem("reconnect_room_id");
    localStorage.removeItem("reconnect_player_id");
}

async function handleRoomExit() {
    if (!Net.roomId) return;
    try {
        if (Net.isHost) {
            const activePlayers = Object.values(Net.players).filter(p => p.id !== Net.playerId && p.isConnected);
            if (activePlayers.length > 0) {
                activePlayers.sort((a, b) => (a.joinedTime || 0) - (b.joinedTime || 0));
                const newHost = activePlayers[0];
                const updates = {};
                updates[`rooms/${Net.roomId}/meta/hostId`] = newHost.id;
                updates[`rooms/${Net.roomId}/players/${newHost.id}/isHost`] = true;
                updates[`rooms/${Net.roomId}/players/${Net.playerId}`] = null;
                await update(ref(db), updates);
            } else {
                await set(ref(db, `rooms/${Net.roomId}`), null);
            }
        } else {
            await set(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), null);
        }
    } catch (err) {
        console.error("Lỗi khi rời phòng:", err);
    } finally {
        cleanSessionStorage();
        handleLocalEvictionCleanup();
    }
}

function handleLocalEvictionCleanup() {
    clearActiveListeners();
    
    Net.roomId = null;
    Net.playerId = null;
    Net.isHost = false;
    Net.isReconnecting = false;
    
    document.body.setAttribute("data-view", "lobby");
    document.getElementById("lobby-room-status")?.classList.add("hidden");
    document.getElementById("join-code-panel")?.classList.add("hidden");
    document.getElementById("game-screen")?.classList.add("hidden");
    document.getElementById("lobby-screen")?.classList.remove("hidden");
    document.getElementById("login-form-panel")?.classList.remove("hidden");
    
    document.querySelectorAll(".code-input").forEach(input => input.value = "");
}

// ==========================================
// 3. ĐỒNG BỘ THỜI GIAN THỰC TỪ FIREBASE & LISTENERS
// ==========================================
function listenToRoom() {
    clearActiveListeners();
    setupActivePlayersPresence();
    setupSpectatorWinPoll();
    setupGMWhisperListener();

    const roomRef = ref(db, `rooms/${Net.roomId}`);
    const unsubRoom = onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            showToast("Phòng chơi đã bị hủy hoặc kết thúc!", "danger");
            handleLocalEvictionCleanup();
            return;
        }
        
        const roomData = snapshot.val();
        
        if (roomData.meta?.hostId === Net.playerId) {
            Net.isHost = true;
        } else if (roomData.players && roomData.players[Net.playerId]?.isHost) {
            Net.isHost = true;
        } else {
            Net.isHost = false;
            const currentHost = roomData.players ? roomData.players[roomData.meta?.hostId] : null;
            if (!currentHost || currentHost.isConnected === false) {
                const onlinePlayers = Object.values(roomData.players || {}).filter(p => p.isConnected);
                onlinePlayers.sort((a, b) => (a.joinedTime || 0) - (b.joinedTime || 0));
                if (onlinePlayers.length > 0 && onlinePlayers[0].id === Net.playerId) {
                    Net.isHost = true;
                    update(ref(db, `rooms/${Net.roomId}/meta`), { hostId: Net.playerId });
                    update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), { isHost: true });
                    showToast("Bạn đã trở thành QUẢN TRÒ mới của phòng chơi!", "success");
                }
            }
        }

        window.G.day = roomData.meta?.day || 0;
        window.G.phase = roomData.meta?.phase || "setup";
        window.G.mayorId = roomData.meta?.mayorId || null;
        window.G.players = Object.values(roomData.players || {});
        window.G.roleCounts = roomData.roleCounts || {};
        Net.players = roomData.players || {};

        if (roomData.meta?.timerEndTime && roomData.meta?.timerDuration) {
            StateMachine.syncPhaseTimer(roomData.meta.timerEndTime, roomData.meta.timerDuration);
        }

        const mayorNameEl = document.getElementById("mayor-name-display");
        if (mayorNameEl) {
            if (roomData.meta?.mayorId && roomData.players[roomData.meta.mayorId]) {
                mayorNameEl.innerText = roomData.players[roomData.meta.mayorId].name;
            } else {
                mayorNameEl.innerText = "Chưa có";
            }
        }

        renderPlayersGridSmartly(roomData);

        const connectedCount = window.G.players.filter(p => p.isConnected).length;
        const lobbyConnectedEl = document.getElementById("lobby-connected-count");
        if (lobbyConnectedEl) lobbyConnectedEl.innerText = connectedCount;

        const isSetupPhaseInLobby = (roomData.meta?.phase === "setup" && !roomData.meta?.started);

        if (isSetupPhaseInLobby) {
            renderLobbyPlayersList();
            
            if (Net.isHost) {
                const otherPlayers = window.G.players.filter(p => p.id !== Net.playerId);
                const allReady = otherPlayers.length > 0 && otherPlayers.every(p => p.isReady);
                const btnStart = document.getElementById("btn-host-start-setup");
                if (btnStart) btnStart.disabled = !allReady;
            }
        } else {
            const lobbyScreen = document.getElementById("lobby-screen");
            if (document.body.getAttribute("data-view") === "lobby" || (lobbyScreen && !lobbyScreen.classList.contains("hidden"))) {
                transitionToGameScreen(roomData);
            }

            if (roomData.meta?.phase === "victory" && roomData.meta?.winner) {
                window.UI_Module.showVictoryScreen(roomData.meta.winner, roomData.meta.mvp, roomData.meta.relations);
            }

            syncLayoutBasedOnRoleAndStatus(roomData);
            syncTrialPhases(roomData);
            updateSovereignStatusAndGuide(roomData);
            
            if (Net.isHost) {
                if (roomData.meta?.phase === "night") {
                    StateMachine.checkAndAutoTransitionToDay();
                } else if (roomData.meta?.phase === "day" && roomData.nominations) {
                    checkMajorityNominationTrigger();
                }
            }
        }

        updateBalanceAndCountsUI();
    });
    activeUnsubscribers.push(unsubRoom);

    if (!Net.isHost) {
        const mailboxRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`);
        const unsubMailbox = onValue(mailboxRef, (snap) => {
            const mails = snap.val() || {};
            renderMailbox(mails);
        });
        activeUnsubscribers.push(unsubMailbox);
    }

    if (Net.isHost) {
        const logsRef = ref(db, `rooms/${Net.roomId}/logs`);
        const unsubLogs = onValue(logsRef, (snap) => {
            const logs = snap.val() || {};
            renderGMLogs(logs);
        });
        activeUnsubscribers.push(unsubLogs);
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
        nameSpan.innerText = `👤 ${p.name}` + (p.isHost ? " 👑" : "");
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
    document.getElementById("lobby-screen")?.classList.add("hidden");
    document.getElementById("game-screen")?.classList.remove("hidden");

    if (Net.isHost) {
        document.getElementById("gm-timeline-container")?.classList.remove("hidden");
        document.getElementById("player-mailbox-container")?.classList.add("hidden");
        document.getElementById("gm-master-console")?.classList.remove("hidden");
        document.getElementById("col-roles-container")?.classList.remove("hidden");
        document.getElementById("chat-subpanel")?.classList.add("hidden");
    } else {
        document.getElementById("gm-timeline-container")?.classList.add("hidden");
        document.getElementById("player-mailbox-container")?.classList.remove("hidden");
        document.getElementById("gm-master-console")?.classList.add("hidden");
        document.getElementById("col-roles-container")?.classList.add("hidden");
        document.getElementById("chat-subpanel")?.classList.remove("hidden");
        setupMailboxCategoryFilters();
    }
    
    window.UI_Module.switchTab(3);
}

// ==========================================
// 4. BẢO VỆ KÊNH CHAT CHẾT & ĐỒNG BỘ LAYOUT
// ==========================================
function syncLayoutBasedOnRoleAndStatus(roomData) {
    const mySelf = Net.players[Net.playerId];
    const phase = roomData.meta?.phase || "setup";
    
    const sleepOverlay = document.getElementById("night-sleep-overlay");
    if (sleepOverlay) {
        if (phase === "night" && mySelf && mySelf.alive && mySelf.turnEnded) {
            sleepOverlay.classList.remove("hidden");
        } else {
            sleepOverlay.classList.add("hidden");
        }
    }

    const chatInputField = document.getElementById("chat-input-field");
    const chatSendBtn = document.getElementById("btn-chat-send");

    const wolfTab = document.getElementById("chan-wolf");
    if (mySelf && mySelf.alive && (mySelf.role === "wolf" || mySelf.realFaction === "wolf")) {
        wolfTab?.classList.remove("hidden");
    } else {
        wolfTab?.classList.add("hidden");
        if (Net.currentChannel === "wolf") {
            Net.currentChannel = "public";
            listenToChatChannel("public");
        }
    }

    if (phase === "night") {
        if (Net.currentChannel === "public") {
            if (chatInputField) {
                chatInputField.disabled = true;
                chatInputField.placeholder = "Màn đêm đã buông xuống... Hãy giữ im lặng!";
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        } else {
            if (chatInputField) {
                chatInputField.disabled = false;
                chatInputField.placeholder = "Nhập tin nhắn nội bộ phe cánh...";
            }
            if (chatSendBtn) chatSendBtn.disabled = false;
        }

        if (mySelf && mySelf.alive) {
            if (mySelf.inCouple && mySelf.coupleId) {
                document.getElementById("chan-couple")?.classList.remove("hidden");
            }
            if (mySelf.primeCovenantId) {
                document.getElementById("chan-prime")?.classList.remove("hidden");
            }
            if (mySelf.vampireFactionId) {
                document.getElementById("chan-vampire")?.classList.remove("hidden");
            }
            if (mySelf.role === "reaper" || mySelf.role === "apprenticeSeer" || mySelf.role === "apprenticeReaper") {
                document.getElementById("chan-reaper")?.classList.remove("hidden");
            }
        }
    } else {
        const dayBannedChannels = ["wolf", "couple", "prime", "vampire", "reaper"];
        if (dayBannedChannels.includes(Net.currentChannel)) {
            Net.currentChannel = "public";
            const pubTab = document.getElementById("chan-public");
            if (pubTab) {
                document.querySelectorAll(".channel-tab").forEach(c => c.classList.remove("active"));
                pubTab.classList.add("active");
                listenToChatChannel("public");
            }
        }

        if (mySelf && mySelf.alive) {
            if (mySelf.isSilencerMuted) {
                if (chatInputField) {
                    chatInputField.disabled = true;
                    chatInputField.placeholder = "Bạn bị câm lặng hôm nay... Im lặng!";
                }
                if (chatSendBtn) chatSendBtn.disabled = true;
            } else {
                if (chatInputField) {
                    chatInputField.disabled = false;
                    chatInputField.placeholder = "Thảo luận công khai...";
                }
                if (chatSendBtn) chatSendBtn.disabled = false;
            }
        } else {
            // Linh Hồn Chat
            document.getElementById("chan-graveyard")?.classList.remove("hidden");
            if (Net.currentChannel === "graveyard") {
                if (chatInputField) {
                    chatInputField.disabled = false;
                    chatInputField.placeholder = "Linh hồn trò chuyện ngầm...";
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
    }

    updatePlayerIdentityCard(mySelf);
    renderDynamicActionControls(roomData, mySelf);
}

function updatePlayerIdentityCard(mySelf) {
    const idCard = document.getElementById("player-identity-card");
    const idRoleVal = document.getElementById("id-role-val");
    const idFactionVal = document.getElementById("id-faction-val");
    const idSkillsSummary = document.getElementById("id-skills-summary");

    if (!idCard || !idRoleVal || !idFactionVal) return;

    if (Net.isHost || !mySelf) {
        idCard.classList.add("hidden");
        return;
    }

    idCard.classList.remove("hidden");
    idRoleVal.innerText = getRoleName(mySelf.role).toUpperCase();
    idFactionVal.innerText = mySelf.realFaction.toUpperCase();

    const skills = ROLE_DB[mySelf.role]?.faction === "wolf" ? "Phe phái Ma Sói: Bỏ phiếu đồng thuận cắn nạn nhân ban đêm." : "Phe Làng/Khác: Thảo luận tìm kiếm phe Ma Sói ban ngày.";
    idSkillsSummary.innerText = skills;
}

function updateSovereignStatusAndGuide(roomData) {
    const phase = roomData.meta?.phase;
    const day = roomData.meta?.day;
    const pTitle = document.getElementById("phase-title-text");
    const scriptText = document.getElementById("script-text");

    if (pTitle) {
        pTitle.innerText = phase === "night" ? `🌙 ĐÊM ĐEN THỨ ${day}` : `☀️ BAN NGÀY THỨ ${day}`;
    }

    if (scriptText) {
        if (phase === "night") {
            scriptText.innerText = "Đêm tối bao phủ... Thần dân và muông thú hãy nhắm mắt đi ngủ!";
        } else {
            scriptText.innerText = "Bình minh hé rạng! Hãy thảo luận tự do vạch mặt kẻ thù.";
        }
    }
}

function renderDynamicActionControls(roomData, mySelf) {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel || !mySelf) return;

    const phase = roomData.meta?.phase || "setup";

    if (phase === "night") {
        if (!mySelf.alive) {
            controlPanel.innerHTML = `<p style="color:var(--log-text); font-style:italic;">Bạn đã hy sinh. Theo dõi ván đấu dưới dạng linh hồn...</p>`;
            return;
        }

        if (mySelf.turnEnded) {
            controlPanel.innerHTML = `<p style="color:var(--success); font-weight:bold; animation: blinker 1.5s infinite;">Đã xong lượt! Đang ngủ say chờ ngày dậy...</p>`;
            return;
        }

        const isPassiveRole = PASSIVE_ROLES.includes(mySelf.role);
        const rIcon = ROLE_ICONS[mySelf.role] || "🔮";

        let buttonHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                ${!isPassiveRole ? `<button id="btn-use-skill" class="btn-accent w-100">${rIcon} KÍCH HOẠT KỸ NĂNG ĐÊM</button>` : `<p style="color:var(--log-text);">Bạn là vai trò thụ động. Hãy yên lặng đi ngủ.</p>`}
                <button id="btn-end-turn" class="btn-success w-100">💤 XÁC NHẬN KẾT THÚC LƯỢT</button>
            </div>
        `;

        controlPanel.innerHTML = buttonHTML;

        document.getElementById("btn-use-skill")?.addEventListener("click", () => {
            openTargetSelection(Object.values(Net.players), mySelf.role, (targetPlayerId, secondaryId, chosenModifier, phrase) => {
                if (mySelf.role === "wolf" || mySelf.role === "wolfBoss" || mySelf.realFaction === "wolf") {
                    set(ref(db, `rooms/${Net.roomId}/wolf_votes/${Net.playerId}`), targetPlayerId);
                }

                set(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/targetSelection`), {
                    actionType: chosenModifier || (mySelf.role + "_action"), 
                    targetId: targetPlayerId,
                    secondaryId: secondaryId,
                    phrase: phrase,
                    timestamp: getSynchronizedTimestamp()
                });
                showToast("Đã ghi nhận mục tiêu hành động đêm!", "success");
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
                Engine_Module.accusePlayer(targetId);
            });
        });
    }
}

// ==========================================
// 5. CÁC PHA XỬ ÁN & TÒA ÁN
// ==========================================
function syncTrialPhases(roomData) {
    const trial = roomData.trial || { stage: "none", accusedId: null };
    const stageContainer = document.getElementById("trial-stage-container");

    const steps = ["step-ind-1", "step-ind-2", "step-ind-3", "step-ind-4"];
    steps.forEach(st => document.getElementById(st)?.classList.remove("active"));

    if (trial.stage === "none") {
        stageContainer?.classList.add("hidden");
        const voteModal = document.getElementById("vote-modal");
        const mayorModal = document.getElementById("mayor-modal");
        if (voteModal) voteModal.style.display = "none";
        if (mayorModal) mayorModal.style.display = "none";
        document.getElementById("trial-vote-progress-wrapper")?.classList.add("hidden");
        return;
    }

    if (trial.stage === "mayor_election") {
        openMayorElectionModal(roomData);
        return;
    }

    stageContainer?.classList.remove("hidden");

    if (trial.stage === "nomination") {
        document.getElementById("step-ind-1")?.classList.add("active");
    }

    if (trial.stage === "defense") {
        document.getElementById("step-ind-2")?.classList.add("active");
        const accusedName = Net.players[trial.accusedId]?.name || "Bị cáo";
        
        if (Net.playerId === trial.accusedId) {
            renderDefenseTypingPanel(true);
        } else {
            renderDefenseTypingPanel(false, accusedName);
        }
    }

    if (trial.stage === "vote") {
        document.getElementById("step-ind-2")?.classList.add("active");
        document.getElementById("step-ind-3")?.classList.add("active");
        openSplitScreenVoteModal(trial.accusedId, roomData);
    }

    if (trial.stage === "verdict") {
        document.getElementById("step-ind-4")?.classList.add("active");
        const voteModal = document.getElementById("vote-modal");
        if (voteModal) voteModal.style.display = "none";
    }
}

function openMayorElectionModal(roomData) {
    const modal = document.getElementById("mayor-modal");
    const grid = document.getElementById("mayor-candidates-grid");
    if (!modal || !grid) return;

    grid.innerHTML = "";
    modal.style.display = "flex";

    const alivePlayers = Object.values(roomData.players || {}).filter(p => p.alive);
    let selectedCandidateId = null;

    alivePlayers.forEach(p => {
        const btn = document.createElement("div");
        btn.className = "target-btn-box";
        btn.innerHTML = `<span class="name">${p.name}</span>`;

        btn.addEventListener("click", () => {
            document.querySelectorAll("#mayor-candidates-grid .target-btn-box").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedCandidateId = p.id;
        });

        grid.appendChild(btn);
    });

    const skipBtn = document.getElementById("btn-mayor-skip");
    if (skipBtn) {
        skipBtn.onclick = () => {
            set(ref(db, `rooms/${Net.roomId}/mayor_votes/${Net.playerId}`), "skip");
            modal.style.display = "none";
            showToast("Bạn đã bỏ phiếu trắng cho chức Trưởng Làng!", "info");
        };
    }

    const submitBtn = document.getElementById("btn-mayor-submit");
    if (submitBtn) {
        submitBtn.onclick = () => {
            if (!selectedCandidateId) {
                showToast("Vui lòng chọn ứng viên Trưởng Làng!", "warning");
                return;
            }
            set(ref(db, `rooms/${Net.roomId}/mayor_votes/${Net.playerId}`), selectedCandidateId);
            modal.style.display = "none";
            showToast("Đã gửi phiếu bầu Trưởng Làng!", "success");
        };
    }
}

function renderDefenseTypingPanel(isAccused, accusedName = "") {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel) return;

    if (activeDefenseUnsub) {
        activeDefenseUnsub();
        activeDefenseUnsub = null;
    }

    if (isAccused) {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; border:2px solid var(--accent)">
                <textarea id="defense-typing-area" placeholder="Nhập lời biện hộ cứu rỗi bản thân..." style="width:100%; height:80px; background:var(--bg-main); color:white; border-radius:6px; padding:8px; border:1px solid var(--border-color);"></textarea>
                <button id="btn-submit-defense-speech" class="btn-success w-100" style="margin-top:10px;">Gửi Lời Biện Hộ</button>
            </div>
        `;
        
        const area = document.getElementById("defense-typing-area");
        if (area) {
            area.addEventListener("input", () => {
                update(ref(db, `rooms/${Net.roomId}/trial`), {
                    accusedText: area.value
                });
            });
        }

        document.getElementById("btn-submit-defense-speech")?.addEventListener("click", () => {
            update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "vote"
            });
        });
    } else {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; text-align:left; min-height:80px; border-left:4px solid var(--accent);">
                <p id="defense-realtime-display" style="font-style:italic; margin:0; color:var(--accent);">Bị cáo [${accusedName}] đang soạn thảo lời bào chữa...</p>
            </div>
        `;
        
        const textRef = ref(db, `rooms/${Net.roomId}/trial/accusedText`);
        activeDefenseUnsub = onValue(textRef, (snap) => {
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
    if (title) title.innerText = `PHÁN QUYẾT SỐ PHẬN: ${Net.players[accusedId]?.name?.toUpperCase()}`;

    const listAcquit = document.getElementById("list-voters-acquit");
    const listExecute = document.getElementById("list-voters-execute");
    if (listAcquit) listAcquit.innerHTML = "";
    if (listExecute) listExecute.innerHTML = "";

    const votes = roomData.votes || {};
    let weightedCountAcquit = 0;
    let weightedCountExecute = 0;

    Object.entries(votes).forEach(([voterId, voteValue]) => {
        const voter = roomData.players[voterId];
        // Kẻ Ngốc đã lật thẻ sẽ mất vĩnh viễn quyền vote
        if (voter && voter.alive && !voter.isIdiotRevealed) {
            const isMayor = (voterId === roomData.meta?.mayorId);
            const weight = isMayor ? 2 : 1;

            const chip = document.createElement("div");
            chip.className = "voter-avatar-chip";
            chip.innerText = voter.name + (isMayor ? " 👑 (2đ)" : "");

            if (voteValue === "ACQUIT") {
                weightedCountAcquit += weight;
                if (listAcquit) listAcquit.appendChild(chip);
            } else if (voteValue === "EXECUTE") {
                weightedCountExecute += weight;
                if (listExecute) listExecute.appendChild(chip);
            }
        }
    });

    const cntAcquit = document.getElementById("count-acquit");
    const cntExecute = document.getElementById("count-execute");
    if (cntAcquit) cntAcquit.innerText = weightedCountAcquit;
    if (cntExecute) cntExecute.innerText = weightedCountExecute;

    const progressWrapper = document.getElementById("trial-vote-progress-wrapper");
    const progressFill = document.getElementById("trial-vote-progress-fill");
    const progressRatio = document.getElementById("trial-vote-ratio");

    if (progressWrapper && progressFill && progressRatio) {
        progressWrapper.classList.remove("hidden");
        const totalVotesCount = Object.keys(votes).length;
        const totalAlive = window.G.players.filter(p => p.alive && !p.isIdiotRevealed).length;
        
        progressRatio.innerText = `${totalVotesCount}/${totalAlive}`;
        const pct = totalAlive > 0 ? (totalVotesCount / totalAlive) * 100 : 0;
        progressFill.style.width = `${pct}%`;
    }

    const btnAcquit = document.getElementById("btn-vote-acquit");
    if (btnAcquit) {
        btnAcquit.onclick = () => {
            const mySelf = Net.players[Net.playerId];
            if (mySelf && (!mySelf.alive || mySelf.isIdiotRevealed)) return;
            set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "ACQUIT");
        };
    }

    const btnExecute = document.getElementById("btn-vote-execute");
    if (btnExecute) {
        btnExecute.onclick = () => {
            const mySelf = Net.players[Net.playerId];
            if (mySelf && (!mySelf.alive || mySelf.isIdiotRevealed)) return;
            set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "EXECUTE");
        };
    }
}

// ==========================================
// 6. HỆ THỐNG HÒM THƯ (MAILBOX SYSTEM)
// ==========================================
function renderMailbox(mails) {
    const container = document.getElementById("mailbox-list");
    if (!container) return;
    container.innerHTML = "";

    const mailArray = Object.entries(mails).map(([id, data]) => ({ id, ...data }));
    mailArray.sort((a, b) => b.timestamp - a.timestamp);

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

    update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${mail.id}`), {
        isRead: true
    });

    const closeBtn = document.getElementById("btn-close-parchment");
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = "none";
        };
    }
}

function setupParchmentNavigation() {
    const btnPrev = document.getElementById("btn-prev-parchment");
    const btnNext = document.getElementById("btn-next-parchment");

    if (!btnPrev || !btnNext) return;

    btnPrev.addEventListener("click", () => {
        if (currentMailIndex > 0) {
            currentMailIndex--;
            openParchmentMail(openedMailsList[currentMailIndex]);
        } else {
            showToast("Đây là mật thư đầu tiên!", "info");
        }
    });

    btnNext.addEventListener("click", () => {
        if (currentMailIndex < openedMailsList.length - 1) {
            currentMailIndex++;
            openParchmentMail(openedMailsList[currentMailIndex]);
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
                showToast("Đã đánh dấu đọc tất cả mật thư!", "success");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

// ==========================================
// 7. KÊNH THẢO LUẬN MULTI-CHANNEL & MẬT THƯ GM
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

    const channels = ["chan-public", "chan-wolf", "chan-couple", "chan-prime", "chan-vampire", "chan-reaper", "chan-graveyard"];
    channels.forEach(ch => {
        document.getElementById(ch)?.addEventListener("click", () => {
            channels.forEach(c => document.getElementById(c)?.classList.remove("active"));
            document.getElementById(ch)?.classList.add("active");
            
            const chanName = ch.replace("chan-", "");
            Net.currentChannel = chanName;

            let mappedFirebasePath = chanName;
            const mySelf = Net.players[Net.playerId];

            if (chanName === "couple" && mySelf && mySelf.coupleId) {
                mappedFirebasePath = mySelf.coupleId;
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
        timestamp: getSynchronizedTimestamp()
    };

    try {
        await push(chatRef, messagePayload);
        input.value = "";
    } catch (err) {
        console.error("Lỗi gửi chat:", err);
    }
}

function listenToChatChannel(channelPath) {
    if (activeChatUnsub) {
        activeChatUnsub();
        activeChatUnsub = null;
    }

    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${channelPath}`);
    activeChatUnsub = onValue(chatRef, (snap) => {
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;

        const isNearBottom = chatBox.scrollHeight - chatBox.clientHeight - chatBox.scrollTop < 80;

        chatBox.innerHTML = "";
        const messages = snap.val() || {};
        Object.values(messages).forEach(m => {
            const row = document.createElement("div");
            row.className = `chat-msg ${Net.currentChannel}`;
            row.style.marginBottom = "6px";
            row.style.lineHeight = "1.4";
            row.innerHTML = `<b style="color:var(--accent)">${m.senderName}:</b> ${m.text}`;
            chatBox.appendChild(row);
        });

        if (isNearBottom) {
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
}

function setupGMWhisperListener() {
    if (activeGMWhisperUnsub || !Net.roomId || !Net.playerId) return;

    const whisperRef = ref(db, `rooms/${Net.roomId}/gm_whispers/${Net.playerId}`);
    activeGMWhisperUnsub = onValue(whisperRef, (snap) => {
        const whispers = snap.val() || {};
        const latestKey = Object.keys(whispers).pop();
        if (latestKey) {
            const whisperMsg = whispers[latestKey];
            showToast(`💬 [MẬT THƯ GM]: ${whisperMsg.text}`, "info");
        }
    });
}

export async function sendGMWhisper(targetPlayerId, messageText) {
    if (!Net.isHost || !Net.roomId) return;
    const whisperRef = ref(db, `rooms/${Net.roomId}/gm_whispers/${targetPlayerId}`);
    try {
        await push(whisperRef, {
            text: messageText,
            timestamp: getSynchronizedTimestamp()
        });
        showToast(`Đã gửi mật thư tới ${Net.players[targetPlayerId]?.name}!`, "success");
    } catch (err) {
        console.error("Lỗi gửi mật thư GM:", err);
    }
}

function setupSpectatorWinPoll() {
    if (spectatorPollConfigured || !Net.roomId) return;
    spectatorPollConfigured = true;

    const buttons = [
        { id: "pred-row-village-trigger", faction: "village" },
        { id: "pred-row-wolf-trigger", faction: "wolf" },
        { id: "pred-row-third-trigger", faction: "third" }
    ];

    buttons.forEach(btn => {
        const triggerEl = document.getElementById(btn.id);
        if (triggerEl) {
            triggerEl.addEventListener("click", async () => {
                if (debounceButton(triggerEl, 1000)) return;

                const mySelf = Net.players[Net.playerId];
                if (mySelf && mySelf.alive) {
                    showToast("Bạn vẫn còn sống, hãy tập trung thảo luận!", "warning");
                    return;
                }
                await set(ref(db, `rooms/${Net.roomId}/prediction_poll/${Net.playerId}`), btn.faction);
            });
        }
    });

    const pollRef = ref(db, `rooms/${Net.roomId}/prediction_poll`);
    const unsubPoll = onValue(pollRef, (snap) => {
        const polls = snap.val() || {};
        const total = Object.keys(polls).length || 1;
        let counts = { village: 0, wolf: 0, third: 0 };
        
        Object.values(polls).forEach(fac => counts[fac]++);

        const vilPct = Math.round((counts.village / total) * 100);
        const wolfPct = Math.round((counts.wolf / total) * 100);
        const thirdPct = Math.round((counts.third / total) * 100);

        const barVil = document.getElementById("pred-bar-village");
        const pctVil = document.getElementById("pred-pct-village");
        if (barVil) barVil.style.width = `${vilPct}%`;
        if (pctVil) pctVil.innerText = `${vilPct}%`;

        const barWolf = document.getElementById("pred-bar-wolf");
        const pctWolf = document.getElementById("pred-pct-wolf");
        if (barWolf) barWolf.style.width = `${wolfPct}%`;
        if (pctWolf) pctWolf.innerText = `${wolfPct}%`;

        const barThird = document.getElementById("pred-bar-third");
        const pctThird = document.getElementById("pred-pct-third");
        if (barThird) barThird.style.width = `${thirdPct}%`;
        if (pctThird) pctThird.innerText = `${thirdPct}%`;
    });
    activeUnsubscribers.push(unsubPoll);
}

// ==========================================
// 8. RENDER BÀN CỜ NGƯỜI CHƠI (DOM DIFFING TỐI ƯU)
// ==========================================
function renderPlayersGridSmartly(roomData) {
    const grid = document.getElementById("game-players-grid");
    if (!grid) return;

    const currentPlayers = Object.values(Net.players);
    const existingCardsMap = {};

    grid.querySelectorAll(".player-grid-card").forEach(card => {
        const id = card.getAttribute("data-id");
        if (id) existingCardsMap[id] = card;
    });

    const wolfVotesNode = roomData?.wolf_votes || {};
    const wolfVoteCounts = {};
    Object.values(wolfVotesNode).forEach(tid => {
        if (tid) wolfVoteCounts[tid] = (wolfVoteCounts[tid] || 0) + 1;
    });

    currentPlayers.forEach(p => {
        let card = existingCardsMap[p.id];

        if (!card) {
            card = document.createElement("div");
            card.className = "player-grid-card";
            card.setAttribute("data-id", p.id);
            
            const dot = document.createElement("span");
            dot.className = "status-dot";
            card.appendChild(dot);

            const name = document.createElement("span");
            name.className = "name";
            card.appendChild(name);

            const roleUnmasked = document.createElement("span");
            roleUnmasked.className = "role-unmasked";
            card.appendChild(roleUnmasked);

            card.addEventListener("click", () => {
                showPlayerBottomSheet(p, Net.isHost);
            });

            grid.appendChild(card);
        }

        const nameEl = card.querySelector(".name");
        const fullNameStr = `👤 ${p.name}`;
        if (nameEl && nameEl.innerText !== fullNameStr) nameEl.innerText = fullNameStr;

        const roleUnmaskedEl = card.querySelector(".role-unmasked");
        if (roleUnmaskedEl) {
            const roleText = Net.isHost ? `[${getRoleName(p.role)}]` : "";
            if (roleUnmaskedEl.innerText !== roleText) roleUnmaskedEl.innerText = roleText;
        }

        const dotEl = card.querySelector(".status-dot");
        if (dotEl) {
            const expectedClass = `status-dot ${p.isConnected ? "online" : "offline"}`;
            if (dotEl.className !== expectedClass) dotEl.className = expectedClass;
        }

        card.className = `player-grid-card ${p.alive ? "" : "dead"}`;
        
        card.querySelectorAll(".wolf-votes, .mayor-star").forEach(el => el.remove());
        
        if (p.id === window.G.mayorId) {
            const star = document.createElement("span");
            star.className = "mayor-star";
            star.innerText = "👑";
            card.appendChild(star);
        }

        const mySelf = Net.players[Net.playerId];
        if (mySelf && (mySelf.role === "wolf" || mySelf.realFaction === "wolf" || Net.isHost)) {
            const votesForThisPlayer = wolfVoteCounts[p.id] || 0;
            if (votesForThisPlayer > 0) {
                const badge = document.createElement("span");
                badge.className = "wolf-votes";
                badge.style.cssText = "position:absolute; bottom:4px; right:4px; background:var(--danger); color:white; font-size:10px; padding:1px 4px; border-radius:8px; font-weight:bold;";
                badge.innerText = `🐺 x${votesForThisPlayer}`;
                card.appendChild(badge);
            }
        }

        applyDecorativeClasses(p, card);
        delete existingCardsMap[p.id];
    });

    Object.values(existingCardsMap).forEach(card => card.remove());
}

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
// 9. CÁC TIỆN ÍCH HOẠT ĐỘNG KHÁC
// ==========================================
function copyRoomId() {
    if (!Net.roomId) return;
    navigator.clipboard.writeText(Net.roomId).then(() => {
        showToast("Đã sao chép mã phòng vào khay nhớ tạm!", "success");
    });
}

function updateBalanceAndCountsUI() {
    if (!window.G) return;
    
    const totalRoleAllocated = Object.values(window.G.roleCounts).reduce((a, b) => a + b, 0);
    const roleCountEl = document.getElementById("role-count");
    const totalEl = document.getElementById("role-player-total");
    if (roleCountEl) roleCountEl.innerText = totalRoleAllocated;
    if (totalEl) totalEl.innerText = window.G.players.length;

    const pCountDisp = document.getElementById('player-count-display');
    if (pCountDisp) pCountDisp.innerText = window.G.players.length;

    if (window.UI_Module) {
        window.UI_Module.updateBalanceUI();
        window.UI_Module.updateActiveRolesSummary();
    }
}

async function toggleReadyState() {
    const btnReady = document.getElementById("btn-player-toggle-ready");
    if (debounceButton(btnReady, 400)) return;

    const mySelf = Net.players[Net.playerId];
    if (!mySelf) return;

    try {
        await update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), {
            isReady: !mySelf.isReady
        });
    } catch (err) {
        console.error("Lỗi thay đổi trạng thái sẵn sàng:", err);
    }
}

async function hostStartSetup() {
    const btnStart = document.getElementById("btn-host-start-setup");
    if (debounceButton(btnStart, 500)) return;

    if (!Net.isHost) return;
    
    try {
        await update(ref(db, `rooms/${Net.roomId}/meta`), {
            phase: "day",
            day: 0
        });
        showToast("Thiết lập hoàn tất! Hãy tiến hành phân phát vai trò.", "success");
    } catch (err) {
        console.error("Lỗi đồng bộ Quản trò bắt đầu:", err);
    }
}