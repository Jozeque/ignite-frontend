#pragma once

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <atomic>
#include <functional>
#include <memory>

// ─── BridgeLink: plugin-side transport to StrideBridge.amxd ─────────────────────
// Plain TCP + newline-framed JSON on 127.0.0.1:9102. Connect-retry every 4s while
// no bridge is in the set. The page CANNOT open this socket itself: WebView2 blocks
// localhost connections from the plugin page (Local Network Access policy), verified
// on the rig 2026-08-26.
//
// OWNED BY THE PROCESSOR, not the editor (2026-08-27): a project load or a rack drop
// must push the stored live lanes to the bridge with no window open - the field
// report was "modulation only starts after I open Stride once". The editor just
// subscribes through the processor while it is open.
//
// Both callbacks are invoked on the MESSAGE THREAD and may fire after this object is
// gone: capture WeakReferences in them, never raw owners. The socket thread never
// touches anything but its own socket and the outbox.
class BridgeLink : private juce::Thread
{
public:
    BridgeLink (std::function<void (const juce::String&)> onLineFn,
                std::function<void (bool)> onStateFn)
        : juce::Thread ("StrideBridgeLink"),
          onLine (std::move (onLineFn)), onState (std::move (onStateFn))
    {
        startThread();
    }

    ~BridgeLink() override
    {
        signalThreadShouldExit();
        notify();                       // break the retry wait immediately
        { const juce::ScopedLock sl (ioLock); if (sock != nullptr) sock->close(); }
        stopThread (3000);
    }

    void send (const juce::String& jsonLine)
    {
        const juce::ScopedLock sl (ioLock);
        outbox.add (jsonLine);
        notify();
    }

    bool isUp() const noexcept { return up.load(); }

private:
    void run() override
    {
        while (! threadShouldExit())
        {
            auto s = std::make_unique<juce::StreamingSocket>();
            if (! s->connect ("127.0.0.1", 9102, 500))
            {
                wait (4000);            // no bridge in the set (yet) - quiet retry
                continue;
            }

            { const juce::ScopedLock sl (ioLock); sock = s.get(); }
            setState (true);

            juce::MemoryBlock pending;
            while (! threadShouldExit())
            {
                flushOutbox (*s);

                const int ready = s->waitUntilReady (true, 150);
                if (ready < 0) break;                       // socket died
                if (ready == 0) continue;                   // nothing to read - loop (also drains outbox)

                char buf[4096];
                const int n = s->read (buf, sizeof (buf), false);
                if (n <= 0) break;                          // peer closed

                pending.append (buf, (size_t) n);
                splitLines (pending);
            }

            { const juce::ScopedLock sl (ioLock); sock = nullptr; }
            setState (false);
        }
    }

    void flushOutbox (juce::StreamingSocket& s)
    {
        juce::StringArray toSend;
        { const juce::ScopedLock sl (ioLock); toSend = outbox; outbox.clear(); }
        for (const auto& line : toSend)
        {
            const juce::String framed = line + "\n";   // keep the String alive: toRawUTF8 on a temporary dangles
            const char* utf8 = framed.toRawUTF8();
            s.write (utf8, (int) strlen (utf8));
        }
    }

    void splitLines (juce::MemoryBlock& pending)
    {
        auto* data = static_cast<const char*> (pending.getData());
        size_t start = 0;
        for (size_t i = 0; i < pending.getSize(); ++i)
        {
            if (data[i] != '\n') continue;
            if (i > start)
                deliver (juce::String::fromUTF8 (data + start, (int) (i - start)));
            start = i + 1;
        }
        if (start > 0)
            pending.removeSection (0, start);
        if (pending.getSize() > (1 << 20)) pending.reset();   // runaway guard: a frame should never near 1MB
    }

    void deliver (const juce::String& line)
    {
        auto fn = onLine;
        juce::MessageManager::callAsync ([fn, line] { if (fn != nullptr) fn (line); });
    }

    void setState (bool nowUp)
    {
        up.store (nowUp);
        auto fn = onState;
        juce::MessageManager::callAsync ([fn, nowUp] { if (fn != nullptr) fn (nowUp); });
    }

    std::function<void (const juce::String&)> onLine;
    std::function<void (bool)> onState;
    juce::CriticalSection ioLock;
    juce::StreamingSocket* sock = nullptr;   // guarded by ioLock; owned by run()'s local
    juce::StringArray outbox;                // guarded by ioLock
    std::atomic<bool> up { false };
};
