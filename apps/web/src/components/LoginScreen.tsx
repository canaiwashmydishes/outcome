import { motion } from 'motion/react';
import { LogIn } from 'lucide-react';

interface Props {
  onLogin: () => void;
  loading: boolean;
  error: string | null;
}

export default function LoginScreen({ onLogin, loading, error }: Props) {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-white p-6 relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 swarm-grid opacity-40 pointer-events-none" />

      <div className="max-w-md w-full space-y-12 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="text-5xl font-light tracking-tighter mb-2">Outcome99</h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-black/50">
            M&A Red-Flag Detection Platform
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="pt-12 space-y-6"
        >
          <button
            onClick={onLogin}
            disabled={loading}
            className="minimal-button flex items-center gap-3 mx-auto disabled:opacity-40"
          >
            <LogIn size={14} />
            <span>{loading ? 'Authenticating...' : 'Initialize Node'}</span>
          </button>

          {error && (
            <p className="text-[10px] uppercase tracking-widest text-red-600">
              {error}
            </p>
          )}

          <p className="text-[10px] text-black/30 uppercase tracking-widest leading-relaxed">
            AI-native decision system for M&A and Private Equity.
            <br />
            Authorization required for deal-room access.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.8 }}
          className="pt-12 border-top-thin pt-8 opacity-40"
        >
          <div className="flex justify-center gap-8 text-[9px] uppercase tracking-[0.3em]">
            <span>Red-Flag Detection</span>
            <span>•</span>
            <span>Source-Backed</span>
            <span>•</span>
            <span>IC-Ready Outputs</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
