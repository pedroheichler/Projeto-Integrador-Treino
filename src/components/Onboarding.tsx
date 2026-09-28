import { useState } from 'react';
import { api } from '../services/api';
import { Dumbbell } from 'lucide-react';

interface OnboardingProps {
  userId: string;
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [modo, setModo] = useState<'escolha' | 'criar' | 'entrar'>('escolha');
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const criarSquad = async () => {
    if (!nome.trim()) { setErro('Digite um nome para o squad'); return; }
    setLoading(true); setErro('');

    const { error } = await api.rpc('create_squad', {
      p_name: nome.trim(),
      p_personal: false,
    });

    setLoading(false);
    if (error) { setErro('Não foi possível criar o squad. Tente novamente.'); return; }
    onComplete();
  };

  const entrarSquad = async () => {
    if (!codigo.trim()) { setErro('Digite o código do squad'); return; }
    setLoading(true); setErro('');

    const { error } = await api.rpc('join_squad_by_code', { p_code: codigo });

    setLoading(false);
    if (error) {
      setErro(error.message.includes('codigo_invalido')
        ? 'Código inválido. Verifique e tente novamente.'
        : 'Não foi possível entrar no squad. Tente novamente.');
      return;
    }
    onComplete();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 400, padding: 32 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, background: 'var(--accent)', borderRadius: 16, marginBottom: 16 }}>
            <Dumbbell color="white" size={28} />
          </div>
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Bem-vindo ao SquadFit!</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>Para começar, crie ou entre em um squad</p>
        </div>

        {/* Tela de escolha */}
        {modo === 'escolha' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => setModo('criar')}
              style={{ padding: '20px 24px', background: 'var(--surface)', border: '1px solid var(--surface-3)', borderRadius: 12, color: '#fff', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--surface-3)'}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>💪 Criar um novo squad</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Você será o admin e poderá convidar membros</div>
            </button>
            <button onClick={() => setModo('entrar')}
              style={{ padding: '20px 24px', background: 'var(--surface)', border: '1px solid var(--surface-3)', borderRadius: 12, color: '#fff', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--surface-3)'}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>🔑 Entrar em um squad</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Use o código de convite que recebeu</div>
            </button>
          </div>
        )}

        {/* Criar squad */}
        {modo === 'criar' && (
          <div>
            <button onClick={() => setModo('escolha')} style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', marginBottom: 20, fontSize: 13 }}>
              ← Voltar
            </button>
            <label style={{ display: 'block', color: '#fff', fontSize: 14, marginBottom: 6 }}>Nome do squad</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Os Brutos do CT"
              style={{ width: '100%', padding: 12, background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, color: '#fff', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />
            {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}
            <button onClick={criarSquad} disabled={loading}
              style={{ width: '100%', padding: 14, background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 15, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Criando...' : 'Criar Squad'}
            </button>
          </div>
        )}

        {/* Entrar no squad */}
        {modo === 'entrar' && (
          <div>
            <button onClick={() => setModo('escolha')} style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', marginBottom: 20, fontSize: 13 }}>
              ← Voltar
            </button>
            <label style={{ display: 'block', color: '#fff', fontSize: 14, marginBottom: 6 }}>Código de convite</label>
            <input value={codigo} onChange={e => setCodigo(e.target.value)}
              placeholder="Ex: ABC123"
              style={{ width: '100%', padding: 12, background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, color: '#fff', fontSize: 14, marginBottom: 16, boxSizing: 'border-box', textTransform: 'uppercase', letterSpacing: 4 }} />
            {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}
            <button onClick={entrarSquad} disabled={loading}
              style={{ width: '100%', padding: 14, background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 15, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Entrando...' : 'Entrar no Squad'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
