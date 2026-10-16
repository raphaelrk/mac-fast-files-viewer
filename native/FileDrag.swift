import AppKit

// Loaded into the Electrobun process. AppKit's main-thread event monitor starts
// a real file-URL drag from the mouse event, rather than an HTML text/URL drag.
private final class FileDragSource: NSObject, NSDraggingSource {
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        return [.copy, .link]
    }
}
private let dragSource = FileDragSource()
private var monitor: Any?
private var armedPath: String?
private var targetTitle = "Fast Files"
private var mouseDownPoint: NSPoint?

@_cdecl("ff_install_file_drag")
public func installFileDrag() {
    DispatchQueue.main.async {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { event in
            if event.type == .leftMouseDown {
                armedPath = nil
                mouseDownPoint = event.locationInWindow
            } else if event.type == .leftMouseUp {
                armedPath = nil
                mouseDownPoint = nil
            } else if let path = armedPath,
                      let window = event.window, window.title == targetTitle,
                      let view = window.contentView, let start = mouseDownPoint,
                      hypot(event.locationInWindow.x - start.x, event.locationInWindow.y - start.y) >= 5 {
                armedPath = nil
                mouseDownPoint = nil
                let item = NSDraggingItem(pasteboardWriter: NSURL(fileURLWithPath: path))
                let point = view.convert(event.locationInWindow, from: nil)
                let icon = NSWorkspace.shared.icon(forFile: path)
                item.setDraggingFrame(NSRect(x: point.x - 24, y: point.y - 24, width: 48, height: 48), contents: icon)
                let session = view.beginDraggingSession(with: [item], event: event, source: dragSource)
                session.animatesToStartingPositionsOnCancelOrFail = true
                return nil
            }
            return event
        }
    }
}

@_cdecl("ff_arm_file_drag")
public func armFileDrag(_ pathPointer: UnsafePointer<CChar>) {
    let path = String(cString: pathPointer)
    DispatchQueue.main.async {
        // An HTTP request finishing after mouse-up must not arm the next gesture.
        guard NSEvent.pressedMouseButtons & 1 != 0, mouseDownPoint != nil else { return }
        armedPath = path
    }
}
