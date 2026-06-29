import { 
    db, ref, set, get, onValue, update, push, remove, child, onDisconnect, runTransaction 
} from "./firebase-config.js";

// Trạng thái mạng và đồng bộ cục bộ
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

// Khởi tạo ứng dụng khi DOM tải xong
document.addEventListener("DOMContentLoaded", () => {
    initLobbyEngine();
    setupCodeInputNavigation();
    setupTabNavigation();
    setupThemeAndFontListeners();
    setupChatEngine();
    setupSpectatorWinPoll();
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
        setTimeout(dismiss, 2000);
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

    // Khôi phục tên cũ nếu có
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

    // Sự kiện chuyển hướng giữa đăng nhập và nhập mã phòng
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

    // Chuyển tab cấu hình role/chat phía bên phải (Dành cho PC)
    document.getElementById("tab-btn-chat")?.addEventListener("click", () => switchRightSubPanel("chat"));
    document.getElementById("tab-btn-roles-config")?.addEventListener("click", () => switchRightSubPanel("config"));
}

// Logic dịch chuyển con trỏ 6 ô nhập mã phòng
function setupCodeInputNavigation() {
    const inputs = document.querySelectorAll(".code-input");
    inputs.forEach((input, index) => {
        input.addEventListener("input", (e) => {
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
        realFaction: "villager"
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
        alert("Lỗi khi kết nối máy chủ để khởi tạo phòng!");
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
            alert("Mã phòng không tồn tại!");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.meta.started) {
            alert("Ván đấu trong phòng đã bắt đầu, không thể tham gia!");
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
            realFaction: "villager"
        };

        await set(playerRef, playerData);
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        alert("Gặp sự cố khi gia nhập phòng trực tuyến!");
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

    setupPresenceSystem();
}

function setupPresenceSystem() {
    const playerOnlineRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isConnected`);
    const myPresenceRef = ref(db, `.info/connected`);

    onValue(myPresenceRef, (snap) => {
        if (snap.val() === true) {
            onDisconnect(playerOnlineRef).set(false);
            set(playerOnlineRef, true);
        }
    });
}

async function toggleReadyState() {
    if (Net.isHost) return;
    const selfPlayerRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isReady`);
    try {
        const snapshot = await get(selfPlayerRef);
        const currentReady = snapshot.exists() ? snapshot.val() : false;
        await set(selfPlayerRef, !currentReady);

        const btn = document.getElementById("btn-player-toggle-ready");
        if (currentReady) {
            btn.innerText = "ĐÃ SẴN SÀNG (READY!)";
            btn.className = "btn-success w-100";
        } else {
            btn.innerText = "HỦY SẴN SÀNG (READYING...)";
            btn.className = "btn-danger w-100";
        }
    } catch (error) {
        console.error("Lỗi thay đổi trạng thái sẵn sàng:", error);
    }
}

// ==========================================
// 3. ĐỒNG BỘ TRẬN ĐẤU & KỊCH BẢN BỐ CỤC 3 CỘT (SYNC ENGINE)
// ==========================================
function listenToRoom() {
    const roomRef = ref(db, `rooms/${Net.roomId}`);
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            handleRoomTerminated();
            return;
        }

        const data = snapshot.val();
        Net.players = data.players || {};

        // Cập nhật danh sách phòng chờ
        updateLobbyPlayersUI();

        // Kiểm tra điều kiện bắt đầu game (Quản trò kiểm soát)
        if (Net.isHost) {
            const nonHostPlayers = Object.values(Net.players).filter(p => !p.isHost && p.isConnected);
            const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every(p => p.isReady === true);
            document.getElementById("btn-host-start-setup").disabled = !allReady;
        }

        // Đồng bộ chuyển cảnh bắt đầu trận đấu
        if (data.meta.started && document.body.getAttribute("data-view") === "lobby") {
            transitionToGameScreen(data);
        }

        if (data.meta.started) {
            syncGameStateWithEngine(data);
            syncLayoutBasedOnRoleAndStatus(data);
            syncTrialPhases(data);
        }
    });
}

function updateLobbyPlayersUI() {
    const listContainer = document.getElementById("lobby-players-list");
    const connectedCount = document.getElementById("lobby-connected-count");
    if (!listContainer) return;

    listContainer.innerHTML = "";
    let count = 0;

    Object.values(Net.players).forEach(p => {
        if (p.isConnected) {
            count++;
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
        }
    });

    if (connectedCount) connectedCount.innerText = count;
}

// Bố cục 3 Cột và cơ chế hiển thị dựa trên vai trò
function transitionToGameScreen(roomData) {
    document.body.setAttribute("data-view", "game");
    document.getElementById("lobby-screen").classList.add("hidden");
    document.getElementById("game-screen").classList.remove("hidden");

    // Phân tab cho cấu hình vai trò của GM
    const tabConfigBtn = document.getElementById("tab-btn-roles-config");
    if (Net.isHost) {
        tabConfigBtn.classList.remove("hidden");
        document.getElementById("gm-timeline-container").classList.remove("hidden");
        document.getElementById("player-mailbox-container").classList.add("hidden");
    } else {
        tabConfigBtn.classList.add("hidden");
        document.getElementById("gm-timeline-container").classList.add("hidden");
        document.getElementById("player-mailbox-container").classList.remove("hidden");
    }
}

function syncLayoutBasedOnRoleAndStatus(roomData) {
    const mySelf = Net.players[Net.playerId];
    
    // Xử lý chế độ Nghĩa địa / Linh hồn (Spectator & Graveyard Mode)
    if (mySelf && !mySelf.alive) {
        document.body.classList.add("ghostly-mist-active");
        document.getElementById("chan-graveyard")?.classList.remove("hidden");
        document.getElementById("spectator-prediction-widget")?.classList.remove("hidden");
        renderUnmaskedSpectatorGrid();
    } else {
        document.body.classList.remove("ghostly-mist-active");
        document.getElementById("chan-graveyard")?.classList.add("hidden");
        document.getElementById("spectator-prediction-widget")?.classList.add("hidden");
        renderNormalPlayerGrid();
    }

    // Đánh thức / Ẩn kênh chat đêm tương thích với Faction
    if (mySelf && mySelf.alive) {
        if (mySelf.role === "wolf" || mySelf.realFaction === "wolf") {
            document.getElementById("chan-wolf")?.classList.remove("hidden");
        } else {
            document.getElementById("chan-wolf")?.classList.add("hidden");
        }
        
        if (mySelf.inCouple) {
            document.getElementById("chan-couple")?.classList.remove("hidden");
        } else {
            document.getElementById("chan-couple")?.classList.add("hidden");
        }
    }
}

// ==========================================
// 4. HỆ THỐNG BIỂU QUYẾT 4 BƯỚC (TRIAL STEPS ENGINE)
// ==========================================
function syncTrialPhases(roomData) {
    const trial = roomData.trial || { stage: "none", accusedId: null };
    const stageContainer = document.getElementById("trial-stage-container");
    const scriptText = document.getElementById("script-text");

    // Xóa kích hoạt tất cả chỉ số bước
    const steps = ["step-ind-1", "step-ind-2", "step-ind-3", "step-ind-4"];
    steps.forEach(st => document.getElementById(st)?.classList.remove("active"));

    if (trial.stage === "none") {
        stageContainer.classList.add("hidden");
        return;
    }

    stageContainer.classList.remove("hidden");

    // BƯỚC 1: TỐ GIÁC
    if (trial.stage === "nomination") {
        document.getElementById("step-ind-1").classList.add("active");
        scriptText.innerText = "Pha thảo luận tự do: Hãy chạm vào đối tượng nghi ngờ để tiến hành Tố Giác!";
    }

    // BƯỚC 2: BIỆN HỘ
    if (trial.stage === "defense") {
        document.getElementById("step-ind-2").classList.add("active");
        const accusedName = Net.players[trial.accusedId]?.name || "Bị cáo";
        
        if (Net.playerId === trial.accusedId) {
            scriptText.innerHTML = `<span style="color:var(--danger)">VÒNG BIỆN HỘ CỦA BẠN!</span> Hãy nhập lời giải trình...`;
            renderDefenseTypingPanel(true);
        } else {
            scriptText.innerHTML = `Bị cáo <b style="color:var(--accent)">${accusedName}</b> đang trên đài biện hộ...`;
            renderDefenseTypingPanel(false, accusedName);
        }
    }

    // BƯỚC 3: PHÁN QUYẾT
    if (trial.stage === "vote") {
        document.getElementById("step-ind-3").classList.add("active");
        scriptText.innerText = "Thời khắc quyết định: Bỏ phiếu Tha bổng hoặc Xử tử bị cáo!";
        openSplitScreenVoteModal(trial.accusedId);
    }

    // BƯỚC 4: DI NGÔN / PHÁN QUYẾT CHUNG CUỘC
    if (trial.stage === "verdict") {
        document.getElementById("step-ind-4").classList.add("active");
        const accusedName = Net.players[trial.accusedId]?.name || "Bị cáo";
        scriptText.innerHTML = `Di ngôn cuối cùng của <b style="color:var(--danger)">${accusedName}</b> trước giờ hành hình...`;
    }
}

// Nhập ký tự biện hộ đồng bộ thời gian thực dưới 100ms
function renderDefenseTypingPanel(isAccused, accusedName = "") {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel) return;

    if (isAccused) {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; border:2px solid var(--accent)">
                <textarea id="defense-typing-area" placeholder="Nhập lời biện hộ trực quan của bạn..." style="width:100%; height:80px; background:var(--bg-main); color:white; border-radius:6px; padding:8px;"></textarea>
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
        // Người khác xem văn bản biện hộ đang gõ thời gian thực
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; text-align:left; min-height:80px; border-left:4px solid gold;">
                <p id="defense-realtime-display" style="font-style:italic; margin:0; color:gold;">Đang nghe lời bào chữa...</p>
            </div>
        `;
        
        onValue(ref(db, `rooms/${Net.roomId}/trial/accusedText`), (snap) => {
            const txt = snap.val() || "...";
            const display = document.getElementById("defense-realtime-display");
            if (display) display.innerText = `"${txt}"`;
        });
    }
}

// Bảng chia đôi màn hình phán quyết
function openSplitScreenVoteModal(accusedId) {
    const modal = document.getElementById("vote-modal");
    if (!modal) return;
    modal.style.display = "flex";

    const title = document.getElementById("vote-modal-title");
    title.innerText = `PHÁN QUYẾT SỐ PHẬN: ${Net.players[accusedId]?.name?.toUpperCase()}`;

    // Reset danh sách hiển thị cột
    const listAcquit = document.getElementById("list-voters-acquit");
    const listExecute = document.getElementById("list-voters-execute");
    listAcquit.innerHTML = "";
    listExecute.innerHTML = "";

    // Lắng nghe phiếu bầu thời gian thực để thực hiện hoạt ảnh bay
    onValue(ref(db, `rooms/${Net.roomId}/votes`), (snap) => {
        const votes = snap.val() || {};
        listAcquit.innerHTML = "";
        listExecute.innerHTML = "";
        
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
    });

    document.getElementById("btn-vote-acquit")?.addEventListener("click", () => {
        set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "ACQUIT");
    });

    document.getElementById("btn-vote-execute")?.addEventListener("click", () => {
        set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "EXECUTE");
    });
}

// Hoạt ảnh búa tòa án đập (Gavel Strike Animation)
export function runGavelStrikeAnimation(decisionText, callback) {
    const overlay = document.getElementById("gavel-animation-overlay");
    const hammer = document.getElementById("gavel-hammer-element");
    const flash = document.getElementById("gavel-flash-element");
    const announcement = document.getElementById("gavel-verdict-announcement");

    if (!overlay) return;

    announcement.innerText = decisionText;
    overlay.classList.remove("hidden");

    // Tạo âm thanh búa đập
    playAudioSFX("assets/audio/gavel.mp3");

    // Kích hoạt chớp sáng va chạm
    setTimeout(() => {
        if (flash) flash.classList.add("flash-active");
    }, 500);

    // Dọn dẹp hoạt ảnh sau 2.5 giây
    setTimeout(() => {
        overlay.classList.add("hidden");
        if (flash) flash.classList.remove("flash-active");
        if (callback) callback();
    }, 2500);
}

// ==========================================
// 5. HỆ THỐNG HÒM THƯ MAILBOX & LÁ BÀI DA (MAILBOX SYSTEM)
// ==========================================
export function listenToMailbox() {
    const mailboxRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`);
    onValue(mailboxRef, (snap) => {
        const mails = snap.val() || {};
        renderMailbox(mails);
    });
}

function renderMailbox(mails) {
    const container = document.getElementById("mailbox-list");
    if (!container) return;
    container.innerHTML = "";

    const mailArray = Object.entries(mails).map(([id, data]) => ({ id, ...data }));
    
    // Sắp xếp thư mới lên đầu
    mailArray.sort((a, b) => b.timestamp - a.timestamp);

    // Lọc theo Category chọn
    const filteredMails = mailArray.filter(m => {
        if (Net.mailCategory === "all") return true;
        return m.category === Net.mailCategory;
    });

    if (filteredMails.length === 0) {
        container.innerHTML = `<p class="empty-mailbox-hint" style="text-align: center; font-size:13px; opacity:0.5; margin-top:20px;">Hòm thư trống</p>`;
        return;
    }

    filteredMails.forEach(mail => {
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

        card.addEventListener("click", () => openParchmentMail(mail));
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

    // Đồng bộ trạng thái đã đọc lên Firebase
    update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${mail.id}`), {
        isRead: true
    });

    document.getElementById("btn-close-parchment")?.addEventListener("click", () => {
        modal.style.display = "none";
    });
}

// Mark all as read
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
        }
    } catch (err) {
        console.error(err);
    }
});

// ==========================================
// 6. KHÁN GIẢ & KÊNH CHAT BẢO MẬT ĐÊM (SPECTATOR & CHATS)
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

    // Chuyển kênh chat thời gian thực
    const channels = ["chan-public", "chan-wolf", "chan-couple", "chan-graveyard"];
    channels.forEach(ch => {
        document.getElementById(ch)?.addEventListener("click", (e) => {
            channels.forEach(c => document.getElementById(c).classList.remove("active"));
            e.target.classList.add("active");
            
            const chanName = ch.replace("chan-", "");
            Net.currentChannel = chanName;
            listenToChatChannel(chanName);
        });
    });
}

async function sendChatMessage() {
    const input = document.getElementById("chat-input-field");
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${Net.currentChannel}`);
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

function listenToChatChannel(channelName) {
    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${channelName}`);
    onValue(chatRef, (snap) => {
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;
        chatBox.innerHTML = "";

        const messages = snap.val() || {};
        Object.values(messages).forEach(m => {
            const row = document.createElement("div");
            row.className = `chat-msg ${channelName}`;
            row.innerHTML = `<b style="color:var(--accent)">${m.senderName}:</b> ${m.text}`;
            chatBox.appendChild(row);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

// Bảng dự đoán tỉ lệ thắng dành cho Khán giả / Người chết
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
                alert("Bạn còn sống, không thể tham gia dự đoán linh hồn!");
                return;
            }
            // Ghi nhận phiếu dự đoán
            await set(ref(db, `rooms/${Net.roomId}/prediction_poll/${Net.playerId}`), btn.faction);
        });
    });

    // Lắng nghe tỉ lệ dự đoán thời gian thực
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
// 7. BẢN ĐỒ UNMASKED DÀNH CHO LINH HỒN & LẬT BÀI CHIẾN THẮNG
// ==========================================
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
        roleUnmasked.innerText = p.alive ? `👁️ (${p.role.toUpperCase()})` : `(${p.role.toUpperCase()})`;
        
        card.appendChild(dot);
        card.appendChild(name);
        card.appendChild(roleUnmasked);
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
        grid.appendChild(card);
    });
}

// ==========================================
// 8. TIỆN ÍCH PHỤ TRỢ (UTILITIES)
// ==========================================
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function copyRoomId() {
    if (!Net.roomId) return;
    navigator.clipboard.writeText(Net.roomId).then(() => {
        alert("Đã sao chép mã phòng vào khay nhớ tạm!");
    });
}

function switchRightSubPanel(target) {
    const chatPanel = document.getElementById("chat-subpanel");
    const rolesPanel = document.getElementById("roles-config-subpanel");
    const tabChat = document.getElementById("tab-btn-chat");
    const tabConfig = document.getElementById("tab-btn-roles-config");

    if (target === "chat") {
        chatPanel.classList.remove("hidden");
        rolesPanel.classList.add("hidden");
        tabChat.classList.add("active");
        tabConfig.classList.remove("active");
    } else {
        chatPanel.classList.add("hidden");
        rolesPanel.classList.remove("hidden");
        tabChat.classList.remove("active");
        tabConfig.classList.add("active");
    }
}

function hostStartSetup() {
    if (!Net.isHost) return;
    update(ref(db, `rooms/${Net.roomId}/meta`), {
        phase: "setup",
        started: true
    });
}

function handleRoomTerminated() {
    alert("Phòng chơi đã giải tán hoặc không thể tìm thấy dữ liệu đồng bộ!");
    location.reload();
}

function playAudioSFX(src) {
    const sfx = document.getElementById("sfx-player");
    if (sfx) {
        sfx.src = src;
        sfx.play().catch(e => console.log("SFX autoplay blocked"));
    }
}

function setupThemeAndFontListeners() {
    const themeSel = document.getElementById("theme-selector");
    const fontSel = document.getElementById("font-selector");

    if (themeSel) {
        themeSel.addEventListener("change", (e) => {
            document.body.setAttribute("data-theme", e.target.value);
            localStorage.setItem("gm_theme", e.target.value);
        });
    }
}

function setupTabNavigation() {
    const tabs = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
    tabs.forEach((tabId, idx) => {
        const el = document.getElementById(tabId);
        if (el) {
            el.addEventListener("click", () => {
                document.body.setAttribute("data-mobile-tab", idx + 1);
                tabs.forEach((t, i) => {
                    const tabEl = document.getElementById(t);
                    if (tabEl) {
                        if (i === idx) tabEl.classList.add("active");
                        else tabEl.classList.remove("active");
                    }
                });
            });
        }
    });
}

function syncGameStateWithEngine(roomData) {
    if (!window.G) return;
    window.G.day = roomData.meta.day || 0;
    window.G.phase = roomData.meta.phase || "setup";
    window.G.players = Object.values(roomData.players || {});
    
    // Khởi tạo Mailbox Listener ngay khi bắt đầu chơi
    if (!Net.isHost && window.G.phase !== "setup") {
        listenToMailbox();
    }
}