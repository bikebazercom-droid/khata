import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, LoaderCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { bn } from 'date-fns/locale';
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@workspace/api-client-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  isInsideNativeWebView,
  NATIVE_PUSH_STATUS_EVENT,
  OWNER_PUSH_REGISTRATION_EVENT,
  postNativePushMessage,
  STORED_OWNER_PUSH_TOKEN_KEY,
} from '@/lib/nativePushBridge';
import { toast } from 'sonner';

interface NotificationBellProps {
  businessId: string | null;
  onOpenParty: (businessId: string, partyId: string) => void;
}

export function NotificationBell({ businessId, onOpenParty }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPending, setPushPending] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = businessScopedQueryKey(getListNotificationsQueryKey(), businessId);
  const invalidateNotifications = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }, [queryClient]);
  const { data: notifications = [], isLoading, isError } = useListNotifications({
    query: { enabled: Boolean(businessId), queryKey },
  });
  const markRead = useMarkNotificationRead({ mutation: { onSuccess: invalidateNotifications } });
  const markAllRead = useMarkAllNotificationsRead({ mutation: { onSuccess: invalidateNotifications } });
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const inNativeApp = isInsideNativeWebView();

  useEffect(() => {
    setPushEnabled(Boolean(localStorage.getItem(STORED_OWNER_PUSH_TOKEN_KEY)));

    const onRegistration = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      setPushPending(false);
      if (status === 'enabled') {
        setPushEnabled(true);
        toast.success('এই ফোনে নতুন হিসাবের বিজ্ঞপ্তি চালু হয়েছে');
      } else if (status === 'failed') {
        toast.error('এই ফোনে বিজ্ঞপ্তি চালু করা যায়নি');
      }
    };
    const onNativeStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status === 'permission-denied') {
        setPushPending(false);
        toast.error('ফোনের সেটিংস থেকে BanglaKhata বিজ্ঞপ্তির অনুমতি চালু করুন');
      } else if (status === 'not-enabled') {
        setPushPending(false);
        setPushEnabled(false);
      } else if (status === 'unavailable') {
        setPushPending(false);
        toast.error('ফোনে পুশ বিজ্ঞপ্তি চালু করা যায়নি');
      } else if (status === 'granted') {
        setPushPending(true);
      }
    };

    window.addEventListener(OWNER_PUSH_REGISTRATION_EVENT, onRegistration);
    window.addEventListener(NATIVE_PUSH_STATUS_EVENT, onNativeStatus);
    return () => {
      window.removeEventListener(OWNER_PUSH_REGISTRATION_EVENT, onRegistration);
      window.removeEventListener(NATIVE_PUSH_STATUS_EVENT, onNativeStatus);
    };
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="button-notifications"
          aria-label={`বিজ্ঞপ্তি, ${unreadCount}টি অপঠিত`}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white transition-colors hover:bg-white/25 active:scale-95"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span
              data-testid="notification-unread-count"
              className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-extrabold text-slate-900 ring-2 ring-[#1B3A6B]"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-extrabold">বিজ্ঞপ্তি</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {unreadCount ? `${unreadCount}টি অপঠিত` : 'সব বিজ্ঞপ্তি পড়া হয়েছে'}
            </p>
          </div>
          <button
            type="button"
            data-testid="button-mark-all-notifications-read"
            disabled={!unreadCount || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#1B3A6B] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {markAllRead.isPending
              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              : <CheckCheck className="h-3.5 w-3.5" />}
            সব পড়া হয়েছে
          </button>
        </div>

        {inNativeApp && (
          <div className="border-b border-slate-100 px-4 py-3">
            <button
              type="button"
              data-testid="button-enable-phone-notifications"
              disabled={pushPending || pushEnabled}
              onClick={() => {
                setPushPending(true);
                if (!postNativePushMessage('banglakhata-enable-push')) {
                  setPushPending(false);
                  toast.error('ফোনের বিজ্ঞপ্তি চালু করা যায়নি');
                }
              }}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#1B3A6B] px-3 py-2 text-xs font-bold text-white disabled:cursor-default disabled:opacity-60"
            >
              {pushPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {pushEnabled ? 'এই ফোনে বিজ্ঞপ্তি চালু আছে' : pushPending ? 'অনুমতি নেওয়া হচ্ছে…' : 'এই ফোনে বিজ্ঞপ্তি চালু করুন'}
            </button>
          </div>
        )}

        <div className="max-h-[55dvh] overflow-y-auto overscroll-contain">
          {isLoading && (
            <p data-testid="status-notifications-loading" className="px-4 py-7 text-center text-xs text-slate-500">
              বিজ্ঞপ্তি আনা হচ্ছে…
            </p>
          )}
          {isError && (
            <p data-testid="status-notifications-error" className="px-4 py-7 text-center text-xs text-red-600">
              বিজ্ঞপ্তি আনা যায়নি। আবার চেষ্টা করুন।
            </p>
          )}
          {!isLoading && !isError && notifications.length === 0 && (
            <p data-testid="status-notifications-empty" className="px-4 py-7 text-center text-xs text-slate-500">
              এখনো কোনো নতুন বিজ্ঞপ্তি নেই।
            </p>
          )}
          {notifications.map((notification) => (
            <button
              key={notification.id}
              type="button"
              data-testid={`notification-${notification.id}`}
              onClick={() => {
                if (!notification.readAt) markRead.mutate({ notificationId: notification.id });
                setOpen(false);
                if (notification.partyId) onOpenParty(notification.businessId, notification.partyId);
              }}
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                notification.readAt ? 'bg-white' : 'bg-blue-50/70'
              }`}
            >
              <span className="flex items-start gap-2.5">
                {!notification.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-700" />}
                <span className="min-w-0 flex-1">
                  <span data-testid={`text-notification-message-${notification.id}`} className="block text-xs font-semibold leading-5 text-slate-800">
                    {notification.entryCount > 1
                      ? `${notification.actorName} ${notification.entryCount}টি নতুন হিসাব যোগ করেছেন`
                      : `${notification.actorName} ${notification.partyName ? `${notification.partyName} পাটিতে ` : ''}নতুন হিসাব যোগ করেছেন`}
                  </span>
                  <span className="mt-1 block text-[10px] font-medium text-slate-500">
                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: bn })}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
