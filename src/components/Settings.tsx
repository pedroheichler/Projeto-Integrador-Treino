import { useState, useEffect, useRef } from 'react';
import { Copy, LogOut } from 'lucide-react';
import { api, API_URL } from '../services/api';
import { Squad } from '../types';
import type { Session } from '../services/api';

interface SettingsProps {
  session: Session;
  squad: Squad;
  /** true quando é o espaço de treino individual (sem equipe) */
  isPersonal?: boolean;
  theme: 'noite' | 'cal';
  onToggleTheme: () => void;
  onSquadUpdate: (name: string, icon: string) => void;
  onProfileUpdate: (name: string, avatarUrl: string) => void;
  onLeaveSquad: () => void;
  onSquadJoined?: () => void;
}

function SquadSetup({ onComplete }: { onComplete: () => void }) {
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

    // A busca e a associação acontecem no servidor: o cliente não tem (nem
    // precisa de) permissão para ler a lista de squads.
    const { error } = await api.rpc('join_squad_by_code', { p_code: codigo });

    setLoading(false);
    if (error) {
      setErro(
        error.message.includes('codigo_invalido')
          ? 'Código inválido. Verifique e tente novamente.'
          : 'Não foi possível entrar no squad. Tente de novo.'
      );
      return;
    }
    onComplete();
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8 max-w-md">
      <h2 className="font-display text-xl font-bold text-[var(--text)] mb-2">Treinar com amigos</h2>
      <p className="text-sm text-[var(--text-2)] mb-6">
        Opcional — você já pode treinar sozinho normalmente. Crie um squad ou entre num
        existente para acompanhar a sequência da galera e dividir o mesmo plano de treino.
      </p>

      {modo === 'escolha' && (
        <div className="flex flex-col gap-3">
          <button onClick={() => setModo('criar')}
            className="p-5 bg-[var(--surface)] border border-[var(--surface-3)] hover:border-[var(--accent)] rounded-xl text-left transition-colors"
          >
            <div className="text-sm font-semibold text-[var(--btn-fg)] mb-1">💪 Criar um novo squad</div>
            <div className="text-xs text-[var(--text-2)]">Você será o admin e poderá convidar membros</div>
          </button>
          <button onClick={() => setModo('entrar')}
            className="p-5 bg-[var(--surface)] border border-[var(--surface-3)] hover:border-[var(--accent)] rounded-xl text-left transition-colors"
          >
            <div className="text-sm font-semibold text-[var(--btn-fg)] mb-1">🔑 Entrar em um squad</div>
            <div className="text-xs text-[var(--text-2)]">Use o código de convite que recebeu</div>
          </button>
        </div>
      )}

      {modo === 'criar' && (
        <div>
          <button onClick={() => { setModo('escolha'); setErro(''); }} className="text-xs text-[var(--text-2)] hover:text-[var(--text)] mb-4 block">← Voltar</button>
          <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-widest mb-2">Nome do squad</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Os Brutos do CT"
            className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm text-[var(--btn-fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4" />
          {erro && <p className="text-[var(--danger)] text-xs mb-3">{erro}</p>}
          <button onClick={criarSquad} disabled={loading}
            className="w-full bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-60 text-[var(--btn-fg)] py-3 rounded-xl text-sm font-semibold transition-all">
            {loading ? 'Criando...' : 'Criar Squad'}
          </button>
        </div>
      )}

      {modo === 'entrar' && (
        <div>
          <button onClick={() => { setModo('escolha'); setErro(''); }} className="text-xs text-[var(--text-2)] hover:text-[var(--text)] mb-4 block">← Voltar</button>
          <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-widest mb-2">Código de convite</label>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Ex: ABC123"
            className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm text-[var(--btn-fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4 uppercase tracking-widest" />
          {erro && <p className="text-[var(--danger)] text-xs mb-3">{erro}</p>}
          <button onClick={entrarSquad} disabled={loading}
            className="w-full bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-60 text-[var(--btn-fg)] py-3 rounded-xl text-sm font-semibold transition-all">
            {loading ? 'Entrando...' : 'Entrar no Squad'}
          </button>
        </div>
      )}
    </div>
  );
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Endereço público de um arquivo enviado ao backend
function publicUrl(bucket: string, path: string) {
  return `${API_URL}/files/${bucket}/${path}`;
}

function validateImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return 'Use uma imagem JPG, PNG ou WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'A imagem deve ter no máximo 5 MB.';
  return null;
}

export function Settings({ session, squad, isPersonal, theme, onToggleTheme, onSquadUpdate, onProfileUpdate, onLeaveSquad, onSquadJoined }: SettingsProps) {
  const isAdmin = squad.members.find(m => m.id === session?.user?.id)?.role === 'admin';
  // Espaço pessoal não conta como equipe: as seções de squad ficam ocultas
  const hasSquad = !!squad.id && !isPersonal;
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  // Esc fecha a confirmação (a não ser que já esteja saindo)
  useEffect(() => {
    if (!showLeaveConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !leaving) setShowLeaveConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLeaveConfirm, leaving]);

  // Perfil
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState('');
  const [profileStatus, setProfileStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Squad
  const [squadName, setSquadName] = useState(squad.name);
  const [squadIcon, setSquadIcon] = useState(squad.icon || '');
  const [squadIconUploading, setSquadIconUploading] = useState(false);
  const [squadIconUploadError, setSquadIconUploadError] = useState('');
  const [squadStatus, setSquadStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const squadIconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .from('profiles')
      .select('name, avatar_url')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data?.name) setDisplayName(data.name);
        if (data?.avatar_url) setAvatarUrl(data.avatar_url);
      });
  }, [session.user.id]);

  const uploadAvatar = async (file: File) => {
    const validationError = validateImage(file);
    setAvatarUploadError(validationError ?? '');
    if (validationError) return;

    setAvatarUploading(true);
    const path = `${session.user.id}/avatar`;
    const { error } = await api.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
    if (error) {
      console.error('Erro no upload:', error);
      setAvatarUploadError('Não foi possível enviar a imagem.');
      setAvatarUploading(false);
      return;
    }
    const url = publicUrl('avatars', path);
    await api.from('profiles').upsert({ id: session.user.id, avatar_url: url }, { onConflict: 'id' });
    const urlWithCache = url + '?t=' + Date.now();
    setAvatarUrl(urlWithCache);
    onProfileUpdate(displayName, urlWithCache);
    setAvatarUploading(false);
  };

  const uploadSquadIcon = async (file: File) => {
    const validationError = validateImage(file);
    setSquadIconUploadError(validationError ?? '');
    if (validationError) return;

    setSquadIconUploading(true);
    const path = `${squad.id}/icon`;
    const { error } = await api.storage
      .from('squad-icons')
      .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
    if (error) {
      console.error('Erro no upload:', error);
      setSquadIconUploadError('Não foi possível enviar a imagem.');
      setSquadIconUploading(false);
      return;
    }
    const url = publicUrl('squad-icons', path);
    await api.from('squads').update({ icon: url }).eq('id', squad.id);
    setSquadIcon(url + '?t=' + Date.now());
    onSquadUpdate(squadName, url);
    setSquadIconUploading(false);
  };

  const saveProfile = async () => {
    setProfileStatus('saving');
    const { error } = await api
      .from('profiles')
      .upsert({ id: session.user.id, name: displayName }, { onConflict: 'id' });
    if (error) {
      alert('Erro ao salvar configurações.');
      setProfileStatus('error');
      setTimeout(() => setProfileStatus('idle'), 3000);
      return;
    }
    onProfileUpdate(displayName, avatarUrl);
    setProfileStatus('saved');
    setTimeout(() => setProfileStatus('idle'), 2000);
  };

  const saveSquad = async () => {
    setSquadStatus('saving');
    await api
      .from('squads')
      .update({ name: squadName, icon: squadIcon })
      .eq('id', squad.id);
    onSquadUpdate(squadName, squadIcon);
    setSquadStatus('saved');
    setTimeout(() => setSquadStatus('idle'), 2000);
  };

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Squad Setup — quando ainda não tem squad */}
      {!hasSquad && onSquadJoined && (
        <SquadSetup onComplete={onSquadJoined} />
      )}

      {/* Aparência */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8">
        <h2 className="font-display text-xl font-bold text-[var(--text)] mb-1">Aparência</h2>
        <p className="text-sm text-[var(--text-2)] mb-6">Dois temas: um para o dia, outro para a madrugada.</p>

        <div className="grid grid-cols-2 gap-3">
          {([
            { id: 'noite', nome: 'Noite azul', desc: 'Escuro, âmbar na carga', dot: '#6E8FF7', bg: '#0B0F1A' },
            { id: 'cal',   nome: 'Cal e limão', desc: 'Claro, limão no progresso', dot: '#7E9204', bg: '#F2F1EC' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => { if (theme !== t.id) onToggleTheme(); }}
              className={`text-left p-4 rounded-2xl border transition-all ${
                theme === t.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-lg border border-[var(--border-strong)]" style={{ background: t.bg }}>
                  <span className="block w-2 h-2 rounded-full m-2" style={{ background: t.dot }} />
                </span>
                <span className="text-sm font-semibold text-[var(--text)]">{t.nome}</span>
              </div>
              <p className="text-[11px] text-[var(--text-2)]">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Meu Perfil */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8">
        <h2 className="font-display text-xl font-bold text-[var(--text)] mb-6">Meu Perfil</h2>

        <div className="space-y-5">

          {/* Avatar */}
          <div className="flex items-center gap-5">
            <div className="relative">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="avatar"
                  className={`w-20 h-20 rounded-full object-cover bg-[var(--surface-3)] ${avatarUploading ? 'opacity-60' : ''}`}
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-2)] text-2xl">
                  {displayName?.[0]?.toUpperCase() || '?'}
                </div>
              )}
            </div>
            <div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
              />
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="text-xs text-[var(--accent)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {avatarUploading ? 'Enviando...' : 'Trocar foto de perfil'}
              </button>
              <p className="text-xs text-[var(--text-3)] mt-1">JPG, PNG ou WebP · até 5 MB</p>
              {avatarUploadError && <p className="text-xs text-[var(--danger)] mt-1">{avatarUploadError}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-widest mb-2">
              E-mail
            </label>
            <div className="bg-[var(--surface-3)] rounded-xl px-4 py-3 text-sm text-[var(--text-2)]">
              {session.user.email}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-widest mb-2">
              Nome de exibição
            </label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Seu nome"
              className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm text-[var(--btn-fg)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveProfile}
              disabled={profileStatus === 'saving'}
              className="bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-60 text-[var(--btn-fg)] px-6 py-2 rounded-xl text-sm font-semibold transition-all"
            >
              {profileStatus === 'saving' ? 'Salvando...' : profileStatus === 'saved' ? 'Salvo!' : profileStatus === 'error' ? 'Erro!' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {/* Squad — só para admin e quando tem squad */}
      {hasSquad && isAdmin && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8">
          <h2 className="font-display text-xl font-bold text-[var(--text)] mb-6">Configurações do Squad</h2>

          <div className="space-y-5">

            {/* Foto do squad */}
            <div className="flex items-center gap-5">
              <div className="relative">
                {squadIcon ? (
                  <img
                    src={squadIcon}
                    alt="squad"
                    className={`w-20 h-20 rounded-2xl object-cover bg-[var(--surface-3)] ${squadIconUploading ? 'opacity-60' : ''}`}
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-2)] text-2xl">
                    {squadName?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </div>
              <div>
                <input
                  ref={squadIconInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && uploadSquadIcon(e.target.files[0])}
                />
                <button
                  onClick={() => squadIconInputRef.current?.click()}
                  disabled={squadIconUploading}
                  className="text-xs text-[var(--accent)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {squadIconUploading ? 'Enviando...' : 'Trocar foto do squad'}
                </button>
                <p className="text-xs text-[var(--text-3)] mt-1">JPG, PNG ou WebP · até 5 MB</p>
                {squadIconUploadError && <p className="text-xs text-[var(--danger)] mt-1">{squadIconUploadError}</p>}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-widest mb-2">
                Nome do Squad
              </label>
              <input
                type="text"
                value={squadName}
                onChange={e => setSquadName(e.target.value)}
                placeholder="Nome do squad"
                className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm text-[var(--btn-fg)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveSquad}
                disabled={squadStatus === 'saving'}
                className="bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-60 text-[var(--btn-fg)] px-6 py-2 rounded-xl text-sm font-semibold transition-all"
              >
                {squadStatus === 'saving' ? 'Salvando...' : squadStatus === 'saved' ? 'Salvo!' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Equipe — código de convite + membros */}
      {hasSquad && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8">
          <h2 className="font-display text-xl font-bold text-[var(--text)] mb-6">Equipe</h2>

          {isAdmin && (
            <div className="mb-5">
              <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-widest mb-2">
                Código de Convite
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-[var(--surface-3)] rounded-xl px-4 py-3 font-mono text-lg font-bold tracking-widest text-[var(--text)] text-center">
                  {squad.inviteCode || '...'}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(squad.inviteCode || ''); }}
                  className="p-3 bg-[var(--surface-3)] hover:bg-[var(--border-strong)] rounded-xl text-[var(--text-2)] hover:text-[var(--text)] transition-all"
                  title="Copiar código"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>
          )}

          <div className="border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="text-xs text-[var(--text-2)] uppercase tracking-widest font-medium">
                Membros · {squad.members.length}
              </p>
            </div>
            <div className="divide-y divide-[var(--surface-3)]">
              {squad.members.map(member => (
                <div key={member.id} className="px-4 py-3.5 flex items-center gap-3">
                  <img src={member.avatar} alt={member.name}
                    className="w-9 h-9 rounded-full bg-[var(--surface-3)] shrink-0" referrerPolicy="no-referrer" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{member.name}</p>
                    <p className="text-xs text-[var(--text-2)] capitalize">{member.role}</p>
                  </div>
                  {member.role === 'admin' && (
                    <span className="text-[10px] text-[var(--text-2)] bg-[var(--surface-3)] px-2 py-0.5 rounded font-medium">admin</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Zona de Perigo — só quando tem squad */}
      {hasSquad && <div className="bg-[var(--surface)] border border-[var(--danger)] rounded-3xl p-8">
        <h2 className="font-display text-xl font-bold text-[var(--text)] mb-2">Zona de Perigo</h2>
        <p className="text-[var(--text-2)] text-sm mb-6">Ações irreversíveis relacionadas ao seu squad.</p>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">Sair do squad</p>
            <p className="text-xs text-[var(--text-2)] mt-0.5">Você volta a treinar sozinho no seu espaço pessoal. Para retornar ao squad, vai precisar do código de convite.</p>
          </div>
          <button
            onClick={() => { setLeaveError(''); setShowLeaveConfirm(true); }}
            className="ml-6 shrink-0 bg-[var(--danger-soft)] hover:bg-[var(--danger-soft)] border border-[var(--danger)] text-[var(--danger)] px-5 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            Sair do squad
          </button>
        </div>
      </div>}

      {/* Confirmação de saída do squad */}
      {showLeaveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !leaving && setShowLeaveConfirm(false)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl w-full max-w-sm p-7 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-[var(--danger-soft)] border border-red-500/20 flex items-center justify-center mb-5">
              <LogOut size={20} className="text-[var(--danger)]" />
            </div>

            <h3 className="font-display text-lg font-bold text-[var(--text)] mb-2">Sair do squad?</h3>
            <p className="text-sm text-[var(--text-2)] leading-relaxed mb-1">
              Você vai deixar <span className="text-[var(--text)] font-medium">{squad.name || 'o squad'}</span> e
              voltar a treinar sozinho no seu espaço pessoal.
            </p>
            <p className="text-xs text-[var(--text-3)] mb-6">
              Seu histórico continua salvo. Para voltar, vai precisar do código de convite.
            </p>

            {leaveError && (
              <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] rounded-lg px-3 py-2 mb-4">{leaveError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                disabled={leaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-2)] hover:text-[var(--text)] bg-[var(--surface-3)] hover:bg-[var(--surface-3)] transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setLeaving(true);
                  setLeaveError('');
                  const { error } = await api
                    .from('squad_members')
                    .delete()
                    .eq('user_id', session.user.id)
                    .eq('squad_id', squad.id);
                  setLeaving(false);
                  if (error) { setLeaveError('Não foi possível sair: ' + error.message); return; }
                  setShowLeaveConfirm(false);
                  onLeaveSquad();
                }}
                disabled={leaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[var(--btn-fg)] bg-[var(--danger)] hover:bg-[var(--danger)] transition-all disabled:opacity-60"
              >
                {leaving ? 'Saindo...' : 'Sim, sair'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
