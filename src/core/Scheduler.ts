type SchedulerCallback = (cyclesLate: number) => void;
class SchedulerEvent {
    id: SchedulerId;
    ticks: number;
    callback: SchedulerCallback;
    nextEvent: SchedulerEvent | null = null;
    prevEvent: SchedulerEvent | null = null;

    constructor(id: SchedulerId, ticks: number, callback: SchedulerCallback) {
        this.id = id;
        this.ticks = ticks;
        this.callback = callback;
    }
}

enum SchedulerId {
    None = 255,
    RootNode = 254,
    Ppu = 0,
}

class Scheduler {
    constructor() {
        for (let i = 0; i < 64; i++) {
            this.freeEventStack[i] = new SchedulerEvent(SchedulerId.None, 0, () => { });
        }

        let evt = this.popStack();
        evt.id = SchedulerId.RootNode;
        evt.ticks = 0;
        this.rootEvent = evt;
    }

    rootEvent: SchedulerEvent;
    eventsQueued = 0;
    currentTicks = 0;
    nextEventTicks = 0;
    freeEventStackIndex = 0;
    freeEventStack: SchedulerEvent[] = new Array(64);

    popStack(): SchedulerEvent {
        return this.freeEventStack[this.freeEventStackIndex++];
    }

    pushStack(schedulerEvent: SchedulerEvent) {
        this.freeEventStack[--this.freeEventStackIndex] = schedulerEvent;
    }

    static createEmptyEvent() {
        return new SchedulerEvent(SchedulerId.None, 0, () => { });
    }

    addEventRelative(id: SchedulerId, ticks: number, callback: SchedulerCallback) {
        ticks += this.currentTicks;

        let newEvt = this.popStack();
        newEvt.id = id;
        newEvt.ticks = ticks;
        newEvt.callback = callback;

        let prevEvt = this.rootEvent;
        // Traverse linked list and splice at correct location
        while (prevEvt.nextEvent != null) {
            if (ticks >= prevEvt.ticks && ticks <= prevEvt.nextEvent!.ticks) {
                break;
            }
            prevEvt = prevEvt.nextEvent;
        }

        let nextEvt = prevEvt.nextEvent;
        if (nextEvt != null) {
            nextEvt.prevEvent = newEvt;
        }
        prevEvt.nextEvent = newEvt;
        newEvt.nextEvent = nextEvt;
        newEvt.prevEvent = prevEvt;

        this.eventsQueued++;
        this.updateNextEvent();
    }

    cancelEventsById(id: SchedulerId) {
        let events: SchedulerEvent[] = [];

        let evt = this.rootEvent.nextEvent;
        while (evt != null) {
            if (evt.id == id) {
                events.push(evt);
            }
            evt = evt.nextEvent;
        }

        for (let evt of events)
        {
            this.removeEvent(evt);
        }
    }

    updateNextEvent() {
        if (this.eventsQueued > 0) {
            this.nextEventTicks = this.rootEvent.nextEvent!.ticks;
        }
    }

    getFirstEvent(): SchedulerEvent {
        return this.rootEvent.nextEvent!;
    }

    returnEvent = Scheduler.createEmptyEvent();

    popFirstEvent(): SchedulerEvent {
        var evt = this.rootEvent.nextEvent!;
        this.removeEvent(evt);
        return evt;
    }

    removeEvent(schedulerEvent: SchedulerEvent) {
        if (schedulerEvent == this.rootEvent) {
            throw "Cannot remove root event!";
        }
        var prev = schedulerEvent.prevEvent!;
        var next = schedulerEvent.nextEvent!;
        if (schedulerEvent.nextEvent != null) {
            next.prevEvent = prev;
        }
        prev.nextEvent = next;
        schedulerEvent.nextEvent = null;
        schedulerEvent.prevEvent = null;
        this.eventsQueued--;
        this.updateNextEvent();
        this.pushStack(schedulerEvent);
    }
}