export type CharacterId = 'Panda' | 'Rabbit_Bald' | 'Rabbit_Blond' | 'Rabbit_Cyan'
  | 'Rabbit_Green' | 'Rabbit_Grey' | 'Rabbit_Pink' | 'Rabbit_Purple';

export interface CharacterSelectResult {
  characterId: CharacterId;
  displayName: string;
}

const CHARACTERS: { id: CharacterId; label: string; color: string }[] = [
  { id: 'Panda',        label: 'Panda',      color: '#4a4a6a' },
  { id: 'Rabbit_Blond', label: 'Chef Blond', color: '#f5c842' },
  { id: 'Rabbit_Cyan',  label: 'Chef Cyan',  color: '#42c5f5' },
  { id: 'Rabbit_Pink',  label: 'Chef Pink',  color: '#f542a4' },
];

export class CharacterSelect {
  private el: HTMLDivElement;
  private resolve!: (result: CharacterSelectResult) => void;

  constructor(private container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'character-select';
    this.el.innerHTML = `
      <div class="cs-backdrop"></div>
      <div class="cs-panel">
        <h2>Choose Your Chef</h2>
        <p>Pick your character before entering the kitchen</p>
        <div class="cs-grid" id="cs-grid"></div>
        <button class="cs-confirm" id="cs-confirm" disabled>Enter Kitchen</button>
      </div>
    `;
    this.injectStyles();
    this.buildGrid();
    container.appendChild(this.el);
  }

  private injectStyles(): void {
    if (document.getElementById('cs-styles')) return;
    const s = document.createElement('style');
    s.id = 'cs-styles';
    s.textContent = `
      #character-select {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
      }
      .cs-backdrop {
        position: absolute; inset: 0;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        opacity: 0.97;
      }
      .cs-panel {
        position: relative; z-index: 1;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px;
        padding: 40px;
        text-align: center;
        max-width: 680px; width: 90%;
        backdrop-filter: blur(20px);
      }
      .cs-panel h2 {
        color: #fff; font-size: 2rem; font-weight: 700;
        margin: 0 0 6px; letter-spacing: -0.02em;
      }
      .cs-panel > p {
        color: rgba(255,255,255,0.5); font-size: 0.9rem; margin: 0 0 28px;
      }
      .cs-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px; margin-bottom: 28px;
        max-width: 360px; margin-inline: auto;
      }
      .cs-char {
        border-radius: 14px; padding: 16px 8px;
        border: 2px solid rgba(255,255,255,0.1);
        cursor: pointer; transition: all 0.2s;
        background: rgba(255,255,255,0.04);
        display: flex; flex-direction: column; align-items: center; gap: 8px;
      }
      .cs-char:hover { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.08); transform: translateY(-2px); }
      .cs-char.selected { border-color: #29a3dd; background: rgba(41,163,221,0.15); transform: translateY(-2px); }
      .cs-char .avatar {
        width: 56px; height: 56px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 1.8rem;
      }
      .cs-char .name {
        color: rgba(255,255,255,0.8); font-size: 0.75rem; font-weight: 500;
      }
      .cs-confirm {
        width: 100%; padding: 14px;
        background: #29a3dd; color: #fff;
        border: none; border-radius: 12px;
        font-size: 1rem; font-weight: 600; cursor: pointer;
        transition: all 0.2s; letter-spacing: 0.02em;
      }
      .cs-confirm:disabled { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); cursor: not-allowed; }
      .cs-confirm:not(:disabled):hover { background: #1a8cbf; transform: translateY(-1px); }
      @media (max-width: 500px) { .cs-grid { grid-template-columns: repeat(2, 1fr); } }
    `;
    document.head.appendChild(s);
  }

  private buildGrid(): void {
    const grid = this.el.querySelector('#cs-grid')!;
    const confirm = this.el.querySelector('#cs-confirm') as HTMLButtonElement;
    let selected: CharacterId | null = null;
    const EMOJI: Record<CharacterId, string> = {
      Panda: '🐼',
      Rabbit_Bald: '🐰',
      Rabbit_Blond: '🐰',
      Rabbit_Cyan: '🐰',
      Rabbit_Green: '🐰',
      Rabbit_Grey: '🐰',
      Rabbit_Pink: '🐰',
      Rabbit_Purple: '🐰',
    };

    CHARACTERS.forEach(({ id, label, color }) => {
      const div = document.createElement('div');
      div.className = 'cs-char';
      div.innerHTML = `
        <div class="avatar" style="background:${color}22; border: 2px solid ${color}66">${EMOJI[id]}</div>
        <div class="name">${label}</div>
      `;
      div.addEventListener('click', () => {
        grid.querySelectorAll('.cs-char').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        selected = id;
        confirm.disabled = false;
      });
      grid.appendChild(div);
    });

    confirm.addEventListener('click', () => {
      if (!selected) return;
      const char = CHARACTERS.find(c => c.id === selected)!;
      this.destroy();
      this.resolve({ characterId: selected, displayName: char.label });
    });
  }

  show(): Promise<CharacterSelectResult> {
    return new Promise(resolve => { this.resolve = resolve; });
  }

  private destroy(): void {
    this.el.remove();
  }
}
