// frontend/src/components/Login.jsx
import React, { useState } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:5001/api';

const Login = ({ onLoginSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [semester, setSemester] = useState('75'); // Default value
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!username || !password) {
            setError('Please enter username and password.');
            return;
        }
        setIsLoading(true);
        setError('');

        try {
            await axios.post(`${API_URL}/verify-credentials`, {
                username,
                password,
                semester,
            });
            // If verification is successful, pass the credentials up
            onLoginSuccess({ username, password, semester, termName: 'FA 2025-26' });
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-form-container">
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="username">Username</label>
                    <input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="term">Term</label>
                    <select id="term" value={semester} onChange={(e) => setSemester(e.target.value)}>
                        <option value="75">FA 2025-26</option>
                        {/* Add other terms here if needed */}
                    </select>
                </div>
                <button type="submit" disabled={isLoading}>
                    {isLoading ? 'Verifying...' : 'Login'}
                </button>
                {error && <p className="error-message">{error}</p>}
            </form>
        </div>
    );
};

export default Login;