/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - FIREBASE CORE CONFIGURATION MODULE
 * =========================================================================
 * Tệp cấu hình khởi tạo kết nối Firebase App, Realtime Database và Analytics.
 * Cung cấp bộ công cụ điều hướng Reference đường dẫn và giám sát kết nối mạng.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { 
    getDatabase, 
    ref, 
    set, 
    get, 
    onValue, 
    update, 
    push, 
    remove, 
    child, 
    onDisconnect,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// THÔNG SỐ CẤU HÌNH CLOUD FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyANIopuQprhN_dHI2W7WYwwPU2U4_Q8cWQ",
    authDomain: "wolfsovereignonline.firebaseapp.com",
    databaseURL: "https://wolfsovereignonline-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "wolfsovereignonline",
    storageBucket: "wolfsovereignonline.firebasestorage.app",
    messagingSenderId: "325072915230",
    appId: "1:325072915230:web:890a43e396cd847046170f",
    measurementId: "G-0T9D3HPPQL"
};

// 1. Khởi tạo Thực thể Firebase App
const app = initializeApp(firebaseConfig);

// 2. Khởi tạo Thực thể Realtime Database
const db = getDatabase(app);

// 3. Khởi tạo Dịch vụ Analytics An Toàn (Chống nghẽn khi chạy Localhost hoặc bị chặn adblock)
let analytics = null;
isSupported().then((supported) => {
    if (supported) {
        try {
            analytics = getAnalytics(app);
            console.log("🌐 [Firebase Analytics] Khởi tạo thành công.");
        } catch (err) {
            console.warn("⚠️ [Firebase Analytics] Bị trình duyệt chặn:", err.message);
        }
    } else {
        console.warn("⚠️ [Firebase Analytics] Môi trường hiện tại không hỗ trợ Analytics.");
    }
}).catch((err) => {
    console.warn("⚠️ [Firebase Analytics] Kiểm tra hỗ trợ thất bại:", err.message);
});

// 4. TIỆN ÍCH TẠO REFERENCE ĐƯỜNG DẪN CHUẨN TRONG GAME
/**
 * Trả về reference gốc của một phòng chơi cụ thể
 * @param {string} roomId - Mã phòng 6 ký tự
 */
export const getRoomRef = (roomId) => ref(db, `rooms/${roomId}`);

/**
 * Trả về reference dữ liệu Metadata của phòng
 * @param {string} roomId 
 */
export const getMetaRef = (roomId) => ref(db, `rooms/${roomId}/meta`);

/**
 * Trả về reference danh sách toàn bộ người chơi trong phòng
 * @param {string} roomId 
 */
export const getPlayersRef = (roomId) => ref(db, `rooms/${roomId}/players`);

/**
 * Trả về reference thông tin của một người chơi cụ thể
 * @param {string} roomId 
 * @param {string} playerId 
 */
export const getPlayerRef = (roomId, playerId) => ref(db, `rooms/${roomId}/players/${playerId}`);

/**
 * Trả về reference kênh chat cụ thể (Public, Wolf, Couple, Prime, Graveyard...)
 * @param {string} roomId 
 * @param {string} channelPath 
 */
export const getChatsRef = (roomId, channelPath) => ref(db, `rooms/${roomId}/chats/${channelPath}`);

/**
 * Trả về reference Hòm Mật Thư của một người chơi
 * @param {string} roomId 
 * @param {string} playerId 
 */
export const getMailboxRef = (roomId, playerId) => ref(db, `rooms/${roomId}/players/${playerId}/mailbox`);

/**
 * Trả về reference Nhật Ký Quản Trò (GM Logs)
 * @param {string} roomId 
 */
export const getLogsRef = (roomId) => ref(db, `rooms/${roomId}/logs`);

/**
 * Trả về reference Trạng Thái Tòa Án & Biểu Quyết
 * @param {string} roomId 
 */
export const getTrialRef = (roomId) => ref(db, `rooms/${roomId}/trial`);

// 5. BỘ GIÁM SÁT TRẠNG THÁI KẾT NỐI MẠNG (ONLINE/OFFLINE PRESENCE)
/**
 * Lắng nghe trạng thái kết nối tới máy chủ Firebase Realtime Database
 * @param {function(boolean): void} callback - Trả về true nếu Online, false nếu mất mạng
 */
export const monitorServerConnection = (callback) => {
    const connectedRef = ref(db, ".info/connected");
    return onValue(connectedRef, (snap) => {
        const isOnline = snap.val() === true;
        if (typeof callback === "function") {
            callback(isOnline);
        }
    });
};

// 6. Xuất toàn bộ các hàm Primitive của Firebase Database để dùng trên toàn hệ thống
export {
    app,
    db,
    analytics,
    ref,
    set,
    get,
    onValue,
    update,
    push,
    remove,
    child,
    onDisconnect,
    runTransaction
};