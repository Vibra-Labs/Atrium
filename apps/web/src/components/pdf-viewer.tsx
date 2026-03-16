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

export function PdfViewer({
  url,
  overlay,
  onLoadSuccess,
  className,
}: PdfViewerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Observe container width for responsive sizing
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

  // Fetch PDF blob
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

  // Cleanup object URL
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const handleDocumentLoad = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setCurrentPage(1);
      onLoadSuccess?.(n);
    },
    [onLoadSuccess],
  );

  const handlePageLoad = useCallback(
    (page: { width: number; height: number }) => {
      setPageDimensions({ width: page.width, height: page.height });
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
      <div className="flex flex-col items-center">
        <div className="relative inline-block">
          <Document file={objectUrl} onLoadSuccess={handleDocumentLoad}>
            <Page
              pageNumber={currentPage}
              width={pageWidth}
              onLoadSuccess={handlePageLoad}
              renderAnnotationLayer={false}
            />
          </Document>

          {overlay && pageDimensions.width > 0 && (
            <div
              className="absolute inset-0 relative"
              style={{ width: pageWidth, height: (pageWidth / pageDimensions.width) * pageDimensions.height }}
            >
              {overlay(currentPage, {
                width: pageWidth,
                height: (pageWidth / pageDimensions.width) * pageDimensions.height,
              })}
            </div>
          )}
        </div>

        {numPages > 1 && (
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Previous
            </button>
            <span className="text-sm text-[var(--muted-foreground)]">
              Page {currentPage} of {numPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
