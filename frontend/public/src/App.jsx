// frontend/src/App.jsx
import React, { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import './index.css'; // Global styles

function App() {
    // Store user credentials and semester info upon successful login
    const [userSession, setUserSession] = useState(null);

    const handleLoginSuccess = (session) => {
        setUserSession(session);
    };

    const handleLogout = () => {
        setUserSession(null);
    };

    return (
        <div className="app-container">
            <header>
                <h1 className="main-title">ASKADEMIC</h1>
            </header>
            <main>
                {!userSession ? (
                    <Login onLoginSuccess={handleLoginSuccess} />
                ) : (
                    <Dashboard session={userSession} onLogout={handleLogout} />
                )}
            </main>
        </div>   
    );
}

export default App;