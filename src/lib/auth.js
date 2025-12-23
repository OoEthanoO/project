const SESSION_KEY = 'planner.session';
const saveSession = (session, remember) => {
    const store = remember ? localStorage : sessionStorage;
    try {
        if (session) {
            store.setItem(SESSION_KEY, JSON.stringify(session));
        }
        else {
            localStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(SESSION_KEY);
        }
    }
    catch {
        // ignore
    }
};
const loadSession = () => {
    try {
        const fromSession = sessionStorage.getItem(SESSION_KEY);
        const fromLocal = localStorage.getItem(SESSION_KEY);
        const raw = fromSession || fromLocal;
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
};
const callAuth = async (path, payload) => {
    const res = await fetch(`/api/auth${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        // ignore parse error
    }
    if (!res.ok) {
        const msg = data?.error || data?.message || text || 'Auth failed';
        throw new Error(msg);
    }
    return data;
};
export const register = async (email, password, name, remember) => {
    const user = await callAuth('/register', { email, password, name });
    // Do not log in until verified
    if (!user.emailVerified) {
        throw new Error('Verification email sent. Please check your inbox before signing in.');
    }
    saveSession({ token: user.token, user }, remember);
    return user;
};
export const login = async (email, password, remember) => {
    const user = await callAuth('/login', { email, password });
    saveSession({ token: user.token, user }, remember);
    return user;
};
export const logout = () => {
    saveSession(null, false);
};
export const currentUser = () => {
    const session = loadSession();
    return session?.user || null;
};
