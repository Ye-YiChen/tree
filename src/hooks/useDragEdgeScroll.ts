import { raf } from '@rc-component/util';
import type { ListRef } from '@rc-component/virtual-list';
import * as React from 'react';

interface UseDragEdgeScrollOptions {
  listRef: React.RefObject<ListRef>;
  dragging: boolean;
  virtual?: boolean;
  height: number;
  itemHeight: number;
}

/**
 * A virtual list won't auto-scroll when a node is dragged near its edge (the
 * container is `overflow: hidden`, so the browser's native drag-to-edge
 * autoscroll is disabled). Drive the edge scrolling manually on the HTML5 drag
 * events (`dragover` / `dragleave` / `drop` / `dragend`).
 */
export default function useDragEdgeScroll({
  listRef,
  dragging,
  virtual,
  height,
  itemHeight,
}: UseDragEdgeScrollOptions) {
  React.useEffect(() => {
    if (!dragging || virtual === false || !height) {
      return;
    }

    const nativeElement = listRef.current?.nativeElement;
    if (!nativeElement) {
      return;
    }

    // `height / 4` caps each band so top/bottom never overlap on short
    // containers (an idle zone always remains); `itemHeight * 1.2` keeps a
    // one-row feel otherwise.
    const EDGE_THRESHOLD = Math.min(itemHeight * 1.2, height / 4);

    // Same curve as rc-virtual-list `useScrollDrag`: deeper = faster.
    const smoothScrollOffset = (offset: number) => Math.floor(offset ** 0.5);

    let rafId: number | null = null;
    let offset = 0;

    const stopScroll = () => {
      if (rafId !== null) {
        raf.cancel(rafId);
        rafId = null;
      }
      offset = 0;
    };

    const scrollFrame = () => {
      // `scrollTo({ top })` is absolute, so re-read latest offset every frame.
      const inst = listRef.current;
      if (!inst) {
        stopScroll();
        return;
      }
      const { y } = inst.getScrollInfo();
      inst.scrollTo({ top: y + offset });
      rafId = raf(scrollFrame);
    };

    const continueScroll = () => {
      // `0` happens when the pointer sits exactly on the band boundary.
      // Spinning the rAF loop for a no-op would re-render on every frame.
      if (offset === 0) {
        stopScroll();
        return;
      }
      if (rafId === null) {
        rafId = raf(scrollFrame);
      }
    };

    const handleDragOver = (event: DragEvent) => {
      const { top, bottom } = nativeElement.getBoundingClientRect();
      const { clientY } = event;

      if (clientY <= top + EDGE_THRESHOLD) {
        offset = -smoothScrollOffset(top + EDGE_THRESHOLD - clientY);
        continueScroll();
      } else if (clientY >= bottom - EDGE_THRESHOLD) {
        offset = smoothScrollOffset(clientY - (bottom - EDGE_THRESHOLD));
        continueScroll();
      } else {
        stopScroll();
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      // `dragleave` also fires between inner nodes; only stop when truly leaving.
      const related = event.relatedTarget as Node | null;
      if (!related || !nativeElement.contains(related)) {
        stopScroll();
      }
    };

    const ownerDocument = nativeElement.ownerDocument;

    const handleDragEnd = () => {
      stopScroll();
    };

    // `dragover` / `dragleave` need the container rect, so listen on it.
    // `drop` / `dragend` must be listened on the document in the CAPTURE phase:
    // `TreeNode` stops their propagation in the bubble phase, so capture is the
    // only reliable place to observe the drag ending.
    nativeElement.addEventListener('dragover', handleDragOver);
    nativeElement.addEventListener('dragleave', handleDragLeave);
    ownerDocument.addEventListener('drop', handleDragEnd, true);
    ownerDocument.addEventListener('dragend', handleDragEnd, true);

    return () => {
      stopScroll();
      nativeElement.removeEventListener('dragover', handleDragOver);
      nativeElement.removeEventListener('dragleave', handleDragLeave);
      ownerDocument.removeEventListener('drop', handleDragEnd, true);
      ownerDocument.removeEventListener('dragend', handleDragEnd, true);
    };
  }, [dragging, virtual, height, itemHeight, listRef]);
}
