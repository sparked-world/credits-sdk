/**
 * Insufficient Credits Dialog
 *
 * Shows when a user doesn't have enough credits for an action
 *
 * Usage:
 *   import { InsufficientCreditsDialog } from '@/components/insufficient-credits-dialog';
 *
 *   const [showDialog, setShowDialog] = useState(false);
 *
 *   // When you get a 402 response:
 *   if (error.status === 402) {
 *     setShowDialog(true);
 *   }
 *
 *   <InsufficientCreditsDialog
 *     open={showDialog}
 *     onOpenChange={setShowDialog}
 *     required={100}
 *     available={50}
 *   />
 */

'use client';

interface InsufficientCreditsDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog state changes */
  onOpenChange: (open: boolean) => void;
  /** Credits required for the action */
  required: number;
  /** Credits currently available */
  available: number;
  /** Action that was attempted (optional) */
  action?: string;
}

export function InsufficientCreditsDialog({
  open,
  onOpenChange,
  required,
  available,
  action,
}: InsufficientCreditsDialogProps) {
  const shortage = required - available;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={() => onOpenChange(false)}
        aria-label="Close dialog"
      />

      {/* Dialog */}
      <div className="relative bg-background border rounded-lg shadow-lg max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-2">Insufficient Credits</h2>

        <p className="text-muted-foreground mb-4">
          {action
            ? `You don't have enough credits to ${action}.`
            : "You don't have enough credits for this action."}
        </p>

        <div className="bg-muted rounded-lg p-4 mb-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm">Required:</span>
            <span className="font-semibold">{required.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm">Available:</span>
            <span className="font-semibold">{available.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-destructive">
            <span className="text-sm">Shortage:</span>
            <span className="font-semibold">{shortage.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 px-4 py-2 border rounded-lg hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              // TODO: Navigate to purchase page
              window.location.href = '/credits/purchase';
            }}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Add Credits
          </button>
        </div>
      </div>
    </div>
  );
}
