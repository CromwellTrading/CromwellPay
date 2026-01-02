class AuthService {
    static getToken() {
        return localStorage.getItem('cromwell_token');
    }
    
    static setToken(token) {
        localStorage.setItem('cromwell_token', token);
    }
    
    static removeToken() {
        localStorage.removeItem('cromwell_token');
    }
    
    static getUser() {
        const user = localStorage.getItem('cromwell_user');
        return user ? JSON.parse(user) : null;
    }
    
    static setUser(user) {
        localStorage.setItem('cromwell_user', JSON.stringify(user));
    }
    
    static removeUser() {
        localStorage.removeItem('cromwell_user');
    }
    
    static isAuthenticated() {
        return !!this.getToken();
    }
    
    static logout() {
        this.removeToken();
        this.removeUser();
        window.location.href = '/login';
    }
    
    static async verifyToken() {
        const token = this.getToken();
        if (!token) return false;
        
        try {
            const response = await fetch('/api/verify-token', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.setUser(data.user);
                    return true;
                }
            }
        } catch (error) {
            console.error('Token verification failed:', error);
        }
        
        this.logout();
        return false;
    }
}

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthService;
} else {
    window.AuthService = AuthService;
}
