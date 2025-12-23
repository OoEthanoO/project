import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const AuthForm = ({ onLogin, onRegister }) => {
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState('');
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!email.trim() || !password.trim()) {
            setError('Email and password required');
            return;
        }
        try {
            if (mode === 'login') {
                await onLogin(email.trim(), password.trim(), remember);
            }
            else {
                if (!name.trim()) {
                    setError('Name required');
                    return;
                }
                await onRegister(email.trim(), password.trim(), name.trim(), remember);
            }
        }
        catch (err) {
            setError(err.message);
        }
    };
    return (_jsxs("div", { className: "panel", style: { maxWidth: 420, margin: '40px auto', paddingBottom: 20 }, children: [_jsx("div", { className: "header", children: _jsxs("div", { children: [_jsx("p", { className: "title", children: mode === 'login' ? 'Sign in' : 'Create account' }), _jsx("p", { className: "muted", children: "Access your planner with email + password." })] }) }), _jsxs("form", { className: "task-card", onSubmit: handleSubmit, style: { borderStyle: 'dashed' }, children: [_jsxs("div", { className: "form-row", children: [_jsxs("div", { children: [_jsx("label", { className: "muted", children: "Email" }), _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value) })] }), mode === 'register' && (_jsxs("div", { children: [_jsx("label", { className: "muted", children: "Name" }), _jsx("input", { value: name, onChange: (e) => setName(e.target.value) })] })), _jsxs("div", { children: [_jsx("label", { className: "muted", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value) })] })] }), _jsxs("div", { style: { marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: remember, onChange: (e) => setRemember(e.target.checked), id: "remember" }), _jsx("label", { htmlFor: "remember", className: "muted", children: "Remember me" })] }), error && (_jsx("p", { className: "muted", style: { color: '#f88', marginTop: 8 }, children: error })), _jsxs("div", { className: "task-actions", style: { marginTop: 12 }, children: [_jsx("button", { className: "primary", type: "submit", children: mode === 'login' ? 'Login' : 'Register' }), _jsx("button", { className: "secondary", type: "button", onClick: () => {
                                    setMode((m) => (m === 'login' ? 'register' : 'login'));
                                    setError('');
                                }, children: mode === 'login' ? 'Need an account?' : 'Have an account?' })] })] })] }));
};
export default AuthForm;
