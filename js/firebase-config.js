// Khởi tạo và liên kết các thư viện SDK Firebase từ importmap
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
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
} from "firebase/database";

// Thông số cấu hình đồng bộ trực tuyến của ứng dụng
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

// Khởi tạo thực thể Firebase App
const app = initializeApp(firebaseConfig);

// Khởi tạo dịch vụ phân tích dữ liệu (Analytics) một cách an toàn
let analytics = null;
try {
    analytics = getAnalytics(app);
} catch (error) {
    console.warn("Analytics blocked or failed to initialize:", error.message);
}

// Khởi tạo thực thể Realtime Database để đồng bộ trò chơi
const db = getDatabase(app);

// Xuất các thực thể và hàm ra ngoài để hệ thống app.js và game-logic.js sử dụng
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