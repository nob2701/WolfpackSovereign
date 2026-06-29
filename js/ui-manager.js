import { Net } from "./app.js";

// ==========================================
// 1. QUẢN LÝ TRÌNH TỰ MODALS (MODAL QUEUE MANAGER)
// Tránh lỗi hiển thị đè đúp Modals (Modal View Collision)
// ==========================================
export const ModalManager = {
    currentModalId: null,
    modalHistory: [],

    // Mở Modal mới và đẩy Modal cũ vào bộ nhớ đệm
    open(modalId) {
        if (this.currentModalId === modalId) return;

        // Nếu đang có Modal mở, ẩn tạm thời và đẩy vào lịch sử
        if (this.currentModalId) {
            const el = document.getElementById(this.currentModalId);
            if (el) el.style.display = "none";
            this.modalHistory.push(this.currentModalId);
        }

        // Kích hoạt hiển thị Modal mới
        const newEl = document.getElementById(modalId);
        if (newEl) {
            newEl.style.display = "flex";
            this.currentModalId = modalId;
        }
    },

    // Đóng Modal hiện tại và khôi phục Modal trước đó nếu có
    closeCurrent() {
        if (!this.currentModalId) return;

        const el = document.getElementById(this.currentModalId);
        if (el) el.style.display = "none";

        if (this.modalHistory.length > 0) {
            const prevId = this.modalHistory.pop();
            const prevEl = document.getElementById(prevId);
            if (prevEl) prevEl.style.display = "flex";
            this.currentModalId = prevId;
        } else {
            this.currentModalId = null;
        }
    },

    // Đóng toàn bộ các Modals lập tức
    closeAll() {
        const modals = document.querySelectorAll(".custom-modal-overlay");
        modals.forEach(m => m.style.display = "none");
        this.currentModalId = null;
        this.modalHistory = [];
    }
};

// ==========================================
// 2. KHỞI TẠO BẢNG CHỌN MỤC TIÊU ĐỘNG (DYNAMIC TARGET GRID)
// ==========================================
export function openTargetSelection(playersList, actionType, onConfirmCallback) {
    const grid = document.getElementById("target-grid-container");
    if (!grid) return;

    grid.innerHTML = "";
    let selectedPlayerId = null;

    // Chỉ lọc những người chơi còn sống làm mục tiêu hợp lệ
    const validTargets = playersList.filter(p => p.alive && p.id !== Net.playerId);

    if (validTargets.length === 0) {
        alert("Không tìm thấy mục tiêu hợp lệ nào còn sống để thi triển!");
        return;
    }

    validTargets.forEach(p => {
        const targetBtn = document.createElement("div");
        targetBtn.className = "target-btn-box";
        targetBtn.innerHTML = `<span class="name">${p.name}</span>`;
        
        targetBtn.addEventListener("click", () => {
            document.querySelectorAll(".target-btn-box").forEach(btn => btn.classList.remove("selected"));
            targetBtn.classList.add("selected");
            selectedPlayerId = p.id;
        });
        
        grid.appendChild(targetBtn);
    });

    // Ràng buộc sự kiện nút bấm xác nhận
    const submitBtn = document.getElementById("target-modal-submit");
    const cancelBtn = document.getElementById("target-modal-close");

    submitBtn.onclick = () => {
        if (!selectedPlayerId) {
            alert("Vui lòng chạm chọn một mục tiêu trước!");
            return;
        }
        onConfirmCallback(selectedPlayerId);
        ModalManager.closeCurrent();
    };

    cancelBtn.onclick = () => {
        ModalManager.closeCurrent();
    };

    // Gọi hiển thị bảng qua ModalManager an toàn
    ModalManager.open("target-modal");
}

// ==========================================
// 3. ĐỒNG BỘ 5 TABS ĐIỀU HƯỚNG TRÊN DI ĐỘNG (MOBILE LAYOUT SYNC)
// ==========================================
export function initMobileTabSync() {
    const tabSelectors = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
    
    tabSelectors.forEach((tabId, index) => {
        const tabElement = document.getElementById(tabId);
        if (tabElement) {
            tabElement.addEventListener("click", () => {
                // Đặt cấu hình Tab đang chọn lên thẻ Body để CSS xử lý ẩn/hiện cột tương ứng
                document.body.setAttribute("data-mobile-tab", index + 1);
                
                // Đồng bộ hóa trạng thái nút Active
                tabSelectors.forEach(id => {
                    document.getElementById(id)?.classList.remove("active");
                });
                tabElement.classList.add("active");
            });
        }
    });
}

// ==========================================
// 4. BỆNH ÁN CHI TIẾT NGƯỜI CHƠI (PLAYER BOTTOM SHEET)
// ==========================================
export function showPlayerBottomSheet(playerData, isGM = false) {
    const overlay = document.getElementById("player-sheet-overlay");
    const sheet = document.getElementById("player-sheet-modal");
    if (!overlay || !sheet) return;

    // Tiêm cấu trúc dữ liệu người chơi trực tiếp
    sheet.innerHTML = `
        <div class="sheet-header">
            <div class="sheet-avatar">👤</div>
            <div class="sheet-info">
                <h3>${playerData.name}</h3>
                <p>Mã Định Danh: ${playerData.id}</p>
            </div>
        </div>
        
        <div class="switch-row">
            <span class="switch-label">Tình Trạng Sinh Mệnh:</span>
            <span style="font-weight: bold; color: ${playerData.alive ? "var(--success)" : "var(--danger)"}">
                ${playerData.alive ? "🟢 CÒN SỐNG" : "🪦 ĐÃ LOẠI"}
            </span>
        </div>

        ${isGM ? `
            <div class="switch-row" style="background: rgba(225, 29, 72, 0.05); padding: 10px; border-radius: 8px;">
                <span class="switch-label" style="color: var(--danger)">Hành Động Quản Trò (GM Only):</span>
                <button class="btn-danger btn-small" onclick="UI_Module.executeDeath('${playerData.id}')">XỬ TỬ NGƯỜI CHƠI</button>
            </div>
        ` : ""}
        
        <button id="btn-close-sheet" class="btn-suggest w-100" style="margin-top: 20px;">ĐÓNG LÝ LỊCH</button>
    `;

    overlay.style.display = "flex";
    setTimeout(() => {
        sheet.classList.add("show");
    }, 10);

    const closeSheet = () => {
        sheet.classList.remove("show");
        setTimeout(() => {
            overlay.style.display = "none";
        }, 200);
    };

    document.getElementById("btn-close-sheet")?.addEventListener("click", closeSheet);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeSheet();
    });
}

// ==========================================
// 5. QUẢN LÝ TIỆN ÍCH ÂM THANH & CÀI ĐẶT
// ==========================================
export function setupSoundSettings() {
    const bgmPlayer = document.getElementById("bgm-player");
    const sfxPlayer = document.getElementById("sfx-player");
    const bgmVol = document.getElementById("bgm-volume");
    const sfxVol = document.getElementById("sfx-volume");
    const btnMuteBgm = document.getElementById("btn-mute-bgm");
    const btnMuteSfx = document.getElementById("btn-mute-sfx");

    // Lắng nghe chỉnh lượng âm thanh BGM
    bgmVol?.addEventListener("input", (e) => {
        if (bgmPlayer) bgmPlayer.volume = e.target.value;
    });

    // Lắng nghe chỉnh lượng âm thanh SFX
    sfxVol?.addEventListener("input", (e) => {
        if (sfxPlayer) sfxPlayer.volume = e.target.value;
    });

    // Nút tắt BGM nhanh
    btnMuteBgm?.addEventListener("click", () => {
        if (bgmPlayer) {
            bgmPlayer.muted = !bgmPlayer.muted;
            btnMuteBgm.innerText = bgmPlayer.muted ? "Bật BGM" : "Tắt BGM";
            btnMuteBgm.className = bgmPlayer.muted ? "btn-success btn-small" : "btn-danger btn-small";
        }
    });

    // Nút tắt SFX nhanh
    btnMuteSfx?.addEventListener("click", () => {
        if (sfxPlayer) {
            sfxPlayer.muted = !sfxPlayer.muted;
            btnMuteSfx.innerText = sfxPlayer.muted ? "Bật SFX" : "Tắt SFX";
            btnMuteSfx.className = sfxPlayer.muted ? "btn-success btn-small" : "btn-danger btn-small";
        }
    });

    // Xử lý mở panel cài đặt khi bấm nút bánh răng desktop
    document.getElementById("btn-desktop-settings")?.addEventListener("click", () => {
        document.getElementById("panel-settings-donate").style.display = "flex";
        document.getElementById("desktop-overlay").style.display = "block";
    });

    const closeSettings = () => {
        document.getElementById("panel-settings-donate").style.display = "none";
        document.getElementById("desktop-overlay").style.display = "none";
    };

    document.getElementById("btn-close-settings")?.addEventListener("click", closeSettings);
    document.getElementById("desktop-overlay")?.addEventListener("click", closeSettings);
}