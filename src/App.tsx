import { useEffect } from 'react';
import { Deck } from './components/Deck';
import { DrumPad } from './components/DrumPad';
import { Header } from './components/Header';
import { KeyLegend } from './components/KeyLegend';
import { Logo3D } from './components/Logo3D';
import { Mixer } from './components/Mixer';
import { SidePanel } from './components/SidePanel';
import { engine, keyboard } from './state/controller';

export function App() {
  useEffect(() => {
    engine.init();
    const detach = keyboard.attach();
    // A file dropped outside a target must never navigate away from a live mix.
    const block = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      detach();
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="controller">
        <Deck id="A" />
        <div className="center">
          <Logo3D />
          <DrumPad />
        </div>
        <Deck id="B" />
      </main>
      <Mixer />
      <div className="secondary">
        <KeyLegend />
        <SidePanel />
      </div>
      <div className="narrow-note" role="note">
        <b>RHYTHM</b> is played from a computer keyboard. Open it on a laptop or desktop for the full controller.
      </div>
    </div>
  );
}
