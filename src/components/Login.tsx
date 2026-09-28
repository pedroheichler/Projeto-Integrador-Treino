import { useState, type FormEvent } from 'react';
import { api } from '../services/api';
import { Dumbbell } from 'lucide-react';

// Entrar ou criar conta no backend próprio (substitui o login do hub antigo)
export function Login() {
  const [modo, setModo] = useState<'entrar' | 'cadastrar'>('entrar');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !senha) { setErro('Preencha e-mail e senha'); return; }
    if (modo === 'cadastrar' && senha.length < 6) { setErro('A senha precisa ter pelo menos 6 caracteres'); return; }
    setLoading(true); setErro('');

    const { error } = modo === 'entrar'
      ? await api.auth.signInWithPassword({ email: email.trim(), password: senha })
      : await api.auth.signUp({ email: email.trim(), password: senha, options: { data: { name: nome.trim() } } });

    setLoading(false);
    if (error) setErro(error.message);
  };

  const inputStyle = {
    width: '100%', padding: 12, background: 'var(--surface-3)', border: '1px solid var(--border-strong)',
    borderRadius: 8, color: 'var(--text)', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <form onSubmit={enviar} style={{ width: '100%', maxWidth: 400, padding: 32, boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, background: 'var(--accent)', borderRadius: 16, marginBottom: 16 }}>
            <Dumbbell color="white" size={28} />
          </div>
          <h1 className="font-display" style={{ color: 'var(--text)', fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Kronos</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
            {modo === 'entrar' ? 'Entre para continuar treinando' : 'Crie sua conta para começar'}
          </p>
        </div>

        {modo === 'cadastrar' && (
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" style={inputStyle} />
        )}
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail"
          type="email" autoComplete="email" style={inputStyle} />
        <input value={senha} onChange={e => setSenha(e.target.value)} placeholder="Senha"
          type="password" autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} style={inputStyle} />

        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

        <button type="submit" disabled={loading}
          style={{ width: '100%', padding: 14, background: 'var(--btn-bg)', border: 'none', borderRadius: 8, color: 'var(--btn-fg)', fontWeight: 600, cursor: 'pointer', fontSize: 15, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Aguarde...' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
        </button>

        <button type="button" onClick={() => { setModo(modo === 'entrar' ? 'cadastrar' : 'entrar'); setErro(''); }}
          style={{ width: '100%', marginTop: 16, background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 13 }}>
          {modo === 'entrar' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
        </button>
      </form>
    </div>
  );
}
