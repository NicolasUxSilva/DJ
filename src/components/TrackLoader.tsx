import { useRef, useState } from 'react';
import type { DeckId, DeckState } from '../audio/types';

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/** Drag-and-drop target for audio files. Returns [isOver, handlers]. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const props = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };
  return [over, props] as const;
}

/** Empty-deck state shown inside the waveform area. */
export function TrackDrop({ id, deck }: { id: DeckId; deck: DeckState }) {
  return (
    <div className="track-drop">
      <div className="track-drop-title">{deck.loading ? 'DECODING…' : `DROP A TRACK ON DECK ${id}`}</div>
      <div className="track-drop-sub">
        {deck.error ? deck.error : deck.loading ? deck.loading : 'or press LOAD · MP3 · WAV · OGG · M4A'}
      </div>
    </div>
  );
}
