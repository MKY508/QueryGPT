"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import type {ChatMessage} from "@/lib/types/chat";
import {useMessageVirtualizer} from "@/lib/hooks/useMessageVirtualizer";

/** Owns timeline measurements and follow mode, never message execution. */
export function useInvestigationTimeline({messages, pendingTask, focusAnalysisRunId, onReportFocused}: {
  messages: ChatMessage[];
  pendingTask?: string;
  focusAnalysisRunId?: string | null;
  onReportFocused?: () => void;
}) {
  const [isNearLatest, setIsNearLatest] = useState(true);
  const [readPosition, setReadPosition] = useState(() => ({last: messages.at(-1), count: messages.length}));
  const hasNewProgress = !isNearLatest && (messages.at(-1) !== readPosition.last || messages.length > readPosition.count);
  const isNearLatestRef = useRef(true);
  const previousMessagesRef = useRef<ChatMessage[] | null>(null);

  // Virtual scrolling with dynamic heights
  const { parentRef, virtualizer, virtualItems, getTotalSize } =
    useMessageVirtualizer(messages);
  const totalSize = getTotalSize();

  const scrollToLatest = useCallback(() => {
    const scroller = parentRef.current;
    if (!scroller) return;

    scroller.scrollTop = scroller.scrollHeight;
    isNearLatestRef.current = true;
    setIsNearLatest(true);
    setReadPosition({last: messages.at(-1), count: messages.length});
  }, [messages, parentRef]);

  const handleTimelineScroll = useCallback(() => {
    const scroller = parentRef.current;
    if (!scroller) return;

    const nearLatest =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 96;
    isNearLatestRef.current = nearLatest;
    setIsNearLatest(nearLatest);
    if (nearLatest) setReadPosition({last: messages.at(-1), count: messages.length});
  }, [messages, parentRef]);

  // A newly opened conversation starts at its latest result. Later progress
  // follows only while the reader has kept the timeline at the bottom.
  useEffect(() => {
    if (pendingTask) return;

    const previousMessages = previousMessagesRef.current;
    previousMessagesRef.current = messages;

    if (messages.length === 0) {
      isNearLatestRef.current = true;
      return;
    }

    const openingConversation = previousMessages === null || previousMessages.length === 0;
    if (openingConversation || isNearLatestRef.current) {
      const frame = requestAnimationFrame(scrollToLatest);
      return () => cancelAnimationFrame(frame);
    }
  }, [messages, pendingTask, scrollToLatest]);

  // Dynamic report blocks and images can change height after the stream event
  // that created them. Keep following those measurements only at the bottom.
  useEffect(() => {
    if (pendingTask || !messages.length || !isNearLatestRef.current) return;
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [messages.length, pendingTask, scrollToLatest, totalSize]);

  useEffect(() => {
    if (!focusAnalysisRunId || pendingTask || !messages.length) return;
    const targetIndex = messages.findIndex(
      (message) => message.analysisRunId === focusAnalysisRunId
    );
    if (targetIndex < 0) return;

    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(targetIndex, { align: "center" });
      const targetIsLatest = targetIndex >= messages.length - 2;
      isNearLatestRef.current = targetIsLatest;
      setIsNearLatest(targetIsLatest);
      setReadPosition({last: messages.at(-1), count: messages.length});
      onReportFocused?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAnalysisRunId, messages, onReportFocused, pendingTask, virtualizer]);

  return {parentRef, virtualizer, virtualItems, totalSize, isNearLatest, hasNewProgress, scrollToLatest, handleTimelineScroll};
}
