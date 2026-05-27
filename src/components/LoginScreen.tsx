import { googleSignIn } from "../lib/auth";

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const handleLogin = async () => {
    try {
      await googleSignIn();
      onLogin();
    } catch (e) {
      console.error(e);
      alert("Failed to login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="max-w-md w-full bg-slate-950 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Location Milliot</h1>
          <p className="text-slate-400 text-sm">Connectez-vous avec votre compte Google pour accéder à la gestion des maisons et au calendrier.</p>
          
          <button onClick={handleLogin} className="gsi-material-button w-full border border-slate-700 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors py-2.5 flex items-center justify-center space-x-3">
            <div className="gsi-material-button-icon">
              <svg className="w-5 h-5" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                <path fill="none" d="M0 0h48v48H0z"></path>
              </svg>
            </div>
            <span className="font-medium text-slate-200">Se connecter avec Google</span>
          </button>
        </div>
      </div>
    </div>
  );
}
