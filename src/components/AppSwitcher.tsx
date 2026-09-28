import { useState } from 'react';
import { api } from '../services/api';

// No app Android só existe o Treino; Finance e Todolist ficaram no hub web
const APPS = [
  { id: 'treino', nome: 'Treino', url: '/' },
];

interface AppSwitcherProps {
  currentApp: 'finance' | 'treino' | 'todolist';
  userEmail?: string;
}

export function AppSwitcher({ currentApp, userEmail }: AppSwitcherProps) {
  const [open, setOpen] = useState(false);
  const current = APPS.find(a => a.id === currentApp)!;
  const others = APPS.filter(a => a.id !== currentApp);

  const handleSignOut = async () => {
    await api.auth.signOut();
    // Recarrega do zero para não sobrar estado do usuário anterior
    window.location.href = window.location.pathname;
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-3)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)';
        }}
      >
        <span>{current.nome}</span>
        <span style={{ fontSize: 9, color: 'var(--text-2)' }}>▾</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />

          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 6,
            minWidth: 200,
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            zIndex: 100,
          }}>
            {userEmail && (
              <div style={{ padding: '6px 10px 8px', borderBottom: '1px solid var(--surface-3)', marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Conta
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {userEmail}
                </div>
              </div>
            )}

            {others.map(app => (
              <a key={app.id} href={app.url}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 10px',
                  borderRadius: 7,
                  textDecoration: 'none',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span>{app.nome}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 13 }}>→</span>
              </a>
            ))}

            <div style={{ borderTop: '1px solid var(--surface-3)', marginTop: 6, paddingTop: 6 }}>
              <button
                onClick={handleSignOut}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: '9px 10px',
                  borderRadius: 7,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.08)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
                }}
              >
                Sair
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
