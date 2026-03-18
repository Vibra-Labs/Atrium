"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  overlay?: (
    pageNumber: number,
    dimensions: { width: number; height: number },
  ) => React.ReactNode;
  onLoadSuccess?: (numPages: number) => void;
  className?: string;
}

/** Renders a page only when it enters the viewport (or is within 1 page of it). */
function LazyPage({
  pageNumber,
  pageWidth,
  numPages,
  overlay,
  onDimensions,
}: {
  pageNumber: number;
  pageWidth: number;
  numPages: number;
  overlay?: PdfViewerProps["overlay"];
  onDimensions: (pageNumber: number, dims: { width: number; height: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 3); // render first 3 pages immediately
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (visible) return; // already visible
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }, // pre-load 200px before viewport
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="relative" style={!visible ? { minHeight: 800 } : undefined}>
      {visible ? (
        <>
          <Page
            pageNumber={pageNumber}
            width={pageWidth}
            onLoadSuccess={(page) => {
              const d = { width: page.width, height: page.height };
              setDims(d);
              onDimensions(pageNumber, d);
            }}
            renderAnnotationLayer={false}
          />
          {overlay && dims && dims.width > 0 && (
            <div className="absolute inset-0 z-10">
              {overlay(pageNumber, {
                width: pageWidth,
                height: (pageWidth / dims.width) * dims.height,
              })}
            </div>
          )}
          {numPages > 1 && (
            <div className="absolute bottom-2 right-3 text-xs text-[var(--muted-foreground)] bg-[var(--background)]/80 px-2 py-0.5 rounded">
              {pageNumber} / {numPages}
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-xs text-[var(--muted-foreground)]">
          Page {pageNumber}
        </div>
      )}
    </div>
  );
}

export function PdfViewer({
  url,
  overlay,
  onLoadSuccess,
  className,
}: PdfViewerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let revoked = false;
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (!revoked) setObjectUrl(blobUrl);
      } catch (err: unknown) {
        if (!revoked && (err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        if (!revoked) setLoading(false);
      }
    })();
    return () => {
      revoked = true;
      controller.abort();
    };
  }, [url]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const handleDocumentLoad = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      onLoadSuccess?.(n);
    },
    [onLoadSuccess],
  );

  const handlePageDimensions = useCallback(
    (_pageNumber: number, _dims: { width: number; height: number }) => {
      // No-op — dimensions are tracked per-LazyPage
    },
    [],
  );

  const pageWidth = Math.min(containerWidth - 32, 900);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--muted-foreground)] text-sm">
        Loading PDF...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-500 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      <Document
        file={objectUrl}
        onLoadSuccess={handleDocumentLoad}
        className="flex flex-col items-center gap-4"
      >
        {Array.from({ length: numPages }, (_, i) => (
          <LazyPage
            key={i + 1}
            pageNumber={i + 1}
            pageWidth={pageWidth}
            numPages={numPages}
            overlay={overlay}
            onDimensions={handlePageDimensions}
          />
        ))}
      </Document>
    </div>
  );
}
