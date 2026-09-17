import { act, createEvent, fireEvent, render } from '@testing-library/react';
import React from 'react';
import useDragEdgeScroll from '../src/hooks/useDragEdgeScroll';

// `useDragEdgeScroll` is driven through `NodeList` in
// `NodeListEdgeScroll.spec.tsx`. This file covers the two defensive branches
// that cannot be reached from there: the ref is always populated once the
// virtual list mounts, and the cleanup cancels the rAF loop before it can run
// on a torn-down list. Both are only observable by owning the ref directly.
describe('useDragEdgeScroll defensive branches', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  function createList() {
    const holder = document.createElement('div');
    holder.getBoundingClientRect = () =>
      ({ top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }) as DOMRect;
    document.body.appendChild(holder);

    let y = 100;
    const scrollTo = jest.fn(({ top }: { top: number }) => {
      y = top;
    });

    const listRef = {
      current: {
        nativeElement: holder,
        getScrollInfo: () => ({ x: 0, y }),
        scrollTo,
      },
    } as any;

    return { holder, listRef, scrollTo };
  }

  function Comp({
    listRef,
    ...rest
  }: {
    listRef: any;
    dragging?: boolean;
    virtual?: boolean;
    height?: number;
    itemHeight?: number;
  }) {
    useDragEdgeScroll({
      listRef,
      dragging: true,
      virtual: true,
      height: 100,
      itemHeight: 20,
      ...rest,
    });
    return null;
  }

  it('bails out when the list element is not mounted yet', () => {
    const listRef = { current: null } as any;
    const { unmount } = render(<Comp listRef={listRef} />);

    // Nothing to attach to, so nothing may throw — neither on mount (no
    // element to read a rect from) nor on unmount (no cleanup registered).
    expect(() => unmount()).not.toThrow();
  });

  it('cancels the loop when the list goes away mid-scroll', () => {
    const { holder, listRef, scrollTo } = createList();
    render(<Comp listRef={listRef} />);

    fireDragOver(holder, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterEdge = scrollTo.mock.calls.length;
    expect(countAfterEdge).toBeGreaterThan(0);

    // The list is torn down while the next frame is still scheduled. The frame
    // must cancel the loop instead of throwing or spinning on a null ref.
    listRef.current = null;
    act(() => {
      jest.advanceTimersByTime(160);
    });

    expect(scrollTo.mock.calls.length).toBe(countAfterEdge);
  });
});

// jsdom's synthetic drag event drops unknown init props, so assign `clientY`
// directly (same approach as the other drag specs).
function fireDragOver(el: HTMLElement, clientY: number) {
  const event = createEvent.dragOver(el);
  (event as any).clientY = clientY;
  fireEvent(el, event);
}
