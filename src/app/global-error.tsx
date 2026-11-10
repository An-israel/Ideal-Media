"use client";

/**
 * The last resort: an error in the root layout itself, where nothing of the
 * app's own styling can be relied on. Plain markup, inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0b0b0f",
          color: "#f4f4f5",
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Ideal Media couldn&apos;t load</h1>
          <p style={{ fontSize: 14, opacity: 0.7 }}>
            Something went wrong on our side. Please try again in a moment.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.6 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 12,
              height: 40,
              padding: "0 16px",
              borderRadius: 8,
              border: 0,
              background: "#6d5ef8",
              color: "white",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
