/**
 * Modal manager — one scrim, many panels. Generic confirm returns a promise.
 * Every open re-runs the social sweep over the panel.
 */
import { sweepDom } from './social';
import { audio } from './audio';

const scrim = () => document.getElementById('scrim')!;

let openId: string | null = null;

export function openModal(id: string): void {
  closeModal();
  openId = id;
  scrim().classList.add('open');
  const m = document.getElementById(id)!;
  m.classList.add('open');
  sweepDom(m);
  audio.play('ui_click');
}

export function closeModal(): void {
  if (!openId) return;
  document.getElementById(openId)?.classList.remove('open');
  scrim().classList.remove('open');
  openId = null;
}

export function currentModal(): string | null {
  return openId;
}

export function askConfirm(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    document.getElementById('confirm-title')!.textContent = opts.title;
    document.getElementById('confirm-body')!.textContent = opts.message;
    const ok = document.getElementById('confirm-ok') as HTMLButtonElement;
    const cancel = document.getElementById('confirm-cancel') as HTMLButtonElement;
    ok.textContent = opts.confirmLabel ?? 'Confirm';
    cancel.textContent = opts.cancelLabel ?? 'Cancel';
    openModal('m-confirm');
    const done = (v: boolean) => {
      ok.onclick = null;
      cancel.onclick = null;
      closeModal();
      audio.play(v ? 'ui_confirm' : 'ui_click');
      resolve(v);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}

/** Wire all [data-close] buttons once. */
export function wireModalCloseButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => {
    b.addEventListener('click', () => closeModal());
  });
  scrim().addEventListener('pointerdown', (e) => {
    if (e.target === scrim() && openId && !['m-confirm', 'm-resume', 'm-replay', 'm-error'].includes(openId)) {
      closeModal();
    }
  });
}
