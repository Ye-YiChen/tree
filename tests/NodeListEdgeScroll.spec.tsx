import { spyElementPrototypes } from '@rc-component/util';
import { act, createEvent, fireEvent, render } from '@testing-library/react';
import React from 'react';
import VirtualListMock from '@rc-component/virtual-list';
import Tree from '../src';

// Mock the virtual list so we can control `getScrollInfo` and spy on
// `scrollTo`, while still rendering real tree nodes (needed to fire
// `dragStart` and flip the tree into the dragging state). Spies are defined
// INSIDE the factory to avoid the out-of-scope / TDZ restriction, then hung
// on the exported component for the tests to reach.
jest.mock('@rc-component/virtual-list', () => {
  const RealReact = jest.requireActual('react');

  const scrollTo = jest.fn();
  let scrollY = 100;
  const getScrollInfo = jest.fn(() => ({ x: 0, y: scrollY }));

  const List = RealReact.forwardRef((props: any, ref: any) => {
    const holderRef = RealReact.useRef(null);
    RealReact.useImperativeHandle(ref, () => ({
      nativeElement: holderRef.current,
      getScrollInfo,
      scrollTo,
    }));

    const { data, children, prefixCls } = props;
    return RealReact.createElement(
      'div',
      { ref: holderRef, className: `${prefixCls}-holder`, 'data-testid': 'holder' },
      data.map((item: any, index: number) =>
        RealReact.createElement(RealReact.Fragment, { key: index }, children(item)),
      ),
    );
  });

  (List as any).__scrollTo = scrollTo;
  (List as any).__getScrollInfo = getScrollInfo;
  (List as any).__setScrollY = (value: number) => {
    scrollY = value;
  };

  return { __esModule: true, default: List };
});

const scrollToSpy: jest.Mock = (VirtualListMock as any).__scrollTo;
const setScrollY: (value: number) => void = (VirtualListMock as any).__setScrollY;

const treeData = [
  {
    key: '0-0',
    title: '0-0',
    children: [
      { key: '0-0-0', title: '0-0-0' },
      { key: '0-0-1', title: '0-0-1' },
    ],
  },
];

describe('NodeList edge scroll', () => {
  let domSpy: ReturnType<typeof spyElementPrototypes>;

  beforeEach(() => {
    jest.useFakeTimers();
    scrollToSpy.mockClear();
    setScrollY(100);

    // Container rect: top=0, bottom=100, so height=100.
    // EDGE_THRESHOLD = min(itemHeight * 1.2, height / 4) = min(24, 25) = 24.
    // => top band [0, 24], bottom band [76, 100], idle zone in between.
    domSpy = spyElementPrototypes(HTMLElement, {
      getBoundingClientRect: () => ({
        width: 100,
        height: 100,
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
      }),
    });
  });

  afterEach(() => {
    domSpy.mockRestore();
    jest.useRealTimers();
  });

  function renderTree() {
    const result = render(
      <Tree draggable defaultExpandAll treeData={treeData} height={100} itemHeight={20} />,
    );
    // Start dragging so NodeList mounts the edge-scroll listeners.
    fireEvent.dragStart(
      result.container.querySelector('.rc-tree-node-content-wrapper') as HTMLElement,
    );
    const holder = result.container.querySelector('.rc-tree-list-holder') as HTMLElement;
    // Dispatch on the innermost node instead of the holder: that is where the
    // browser really puts the event. Firing on the holder would hit the
    // listener no matter where it is attached, and `TreeNode` calls
    // `stopPropagation()` on `dragover`, so the real path needs proving.
    const node = result.container.querySelector('.rc-tree-node-content-wrapper') as HTMLElement;
    return { ...result, holder, node };
  }

  function tops() {
    return scrollToSpy.mock.calls.map(call => call[0].top);
  }

  // jsdom's synthetic drag event drops unknown init props, so build the event
  // and assign `clientY` directly (same approach as TreeDraggable.spec).
  function fireDragOver(el: HTMLElement, clientY: number) {
    const event = createEvent.dragOver(el);
    (event as any).clientY = clientY;
    fireEvent(el, event);
  }

  function fireDragLeave(el: HTMLElement, relatedTarget: Node | null) {
    const event = createEvent.dragLeave(el);
    (event as any).relatedTarget = relatedTarget;
    fireEvent(el, event);
  }

  it('scrolls up (top decreases) when pointer enters the top edge', () => {
    const { node } = renderTree();

    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToSpy).toHaveBeenCalled();
    // Absolute positioning: current y (100) + negative delta => top < 100.
    expect(tops().every(top => top < 100)).toBe(true);
  });

  it('scrolls down (top increases) when pointer enters the bottom edge', () => {
    const { node } = renderTree();

    fireDragOver(node, 95);
    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToSpy).toHaveBeenCalled();
    // current y (100) + positive delta => top > 100.
    expect(tops().every(top => top > 100)).toBe(true);
  });

  it('stops scrolling when the pointer returns to the middle', () => {
    const { node } = renderTree();

    // Enter edge -> start scrolling.
    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterEdge = scrollToSpy.mock.calls.length;
    expect(countAfterEdge).toBeGreaterThan(0);

    // Back to the idle zone -> cancel the rAF loop.
    fireDragOver(node, 50);
    act(() => {
      jest.advanceTimersByTime(160);
    });

    // No further scrollTo calls after leaving the edge band.
    expect(scrollToSpy.mock.calls.length).toBe(countAfterEdge);
  });

  it('stops scrolling on drop', () => {
    const { holder, node } = renderTree();

    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterEdge = scrollToSpy.mock.calls.length;
    expect(countAfterEdge).toBeGreaterThan(0);

    fireEvent.drop(holder);
    act(() => {
      jest.advanceTimersByTime(160);
    });

    expect(scrollToSpy.mock.calls.length).toBe(countAfterEdge);
  });

  it('stops scrolling on dragend even when released outside the container', () => {
    const { node } = renderTree();

    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterEdge = scrollToSpy.mock.calls.length;
    expect(countAfterEdge).toBeGreaterThan(0);

    // Release anywhere (e.g. document.body), not necessarily on the container.
    // The document-level listener must still stop the rAF loop, otherwise the
    // list keeps scrolling after the drag ends.
    fireEvent.dragEnd(document.body);
    act(() => {
      jest.advanceTimersByTime(320);
    });

    expect(scrollToSpy.mock.calls.length).toBe(countAfterEdge);
  });

  it('reuses the running loop when the pointer stays in the band', () => {
    const { node } = renderTree();

    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterFirst = scrollToSpy.mock.calls.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Still inside the band, so `continueScroll` runs again — but the loop is
    // already scheduled. Scheduling a second one would double the scroll speed.
    fireDragOver(node, 12);
    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToSpy.mock.calls.length - countAfterFirst).toBe(1);
  });

  it('does not spin the rAF loop when the pointer sits on the band boundary', () => {
    const { node } = renderTree();

    // Prove the loop is live first: inside the band but off the boundary.
    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(0);

    // Now sit exactly on `top + EDGE_THRESHOLD` (0 + 24): the distance to the
    // edge is 0, so the offset is 0. The loop must stop instead of calling
    // `scrollTo({ top: y + 0 })` on every frame for nothing.
    fireDragOver(node, 24);
    act(() => {
      jest.advanceTimersByTime(160);
    });
    const countAtBoundary = scrollToSpy.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(160);
    });
    expect(scrollToSpy.mock.calls.length).toBe(countAtBoundary);
  });

  it('stops scrolling when the drag really leaves the container', () => {
    const { node } = renderTree();

    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterEdge = scrollToSpy.mock.calls.length;
    expect(countAfterEdge).toBeGreaterThan(0);

    // `relatedTarget: null` means the pointer left to the outside world.
    fireDragLeave(node, null);
    act(() => {
      jest.advanceTimersByTime(160);
    });

    expect(scrollToSpy.mock.calls.length).toBe(countAfterEdge);
  });

  it('keeps scrolling when the drag only moves between inner nodes', () => {
    const { node } = renderTree();

    fireDragOver(node, 10);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const countAfterEdge = scrollToSpy.mock.calls.length;
    expect(countAfterEdge).toBeGreaterThan(0);

    // `dragleave` also fires when moving between nodes; a `relatedTarget` still
    // inside the container must NOT be treated as leaving.
    fireDragLeave(node, node);
    act(() => {
      jest.advanceTimersByTime(64);
    });

    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(countAfterEdge);
  });
});
