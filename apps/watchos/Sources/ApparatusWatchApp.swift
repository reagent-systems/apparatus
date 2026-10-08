import SwiftUI
import UserNotifications
import WatchKit

@main
struct ApparatusWatchApp: App {
    @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}

/// APNs registration and notification actions. The watch shows handoffs
/// and approvals as notifications only (design spec, Clients and UI). The
/// alert permission is asked on the first call, not here: nothing covers
/// the orb on launch.
final class AppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(Notifier.categories)
        // The device token needs no alert permission; silent pushes wake
        // the socket before it is granted.
        WKApplication.shared().registerForRemoteNotifications()
    }

    // MARK: - APNs

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        onMain { AppModel.shared.registerPush(token: hex) }
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        // No UI for this. Handoff and approval still arrive over the socket
        // while the app runs.
    }

    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any],
                                      fetchCompletionHandler completionHandler: @escaping (WKBackgroundFetchResult) -> Void) {
        // A push wakes the app; the socket carries the state.
        onMain { AppModel.shared.connect() }
        completionHandler(.newData)
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let id = info["approval_id"] as? String {
            switch response.actionIdentifier {
            case Notifier.approveAction: onMain { AppModel.shared.answerApproval(id, approved: true) }
            case Notifier.denyAction: onMain { AppModel.shared.answerApproval(id, approved: false) }
            default: break
            }
        }
        completionHandler()
    }
}

/// Local notifications for S2C handoff and approval events. Remote pushes
/// with the same `category` and `approval_id` keys get the same actions.
enum Notifier {
    static let handoffCategory = "apparatus.handoff"
    static let approvalCategory = "apparatus.approval"
    static let approveAction = "apparatus.approve"
    static let denyAction = "apparatus.deny"

    static var categories: Set<UNNotificationCategory> {
        let approve = UNNotificationAction(identifier: approveAction, title: "Approve", options: [])
        let deny = UNNotificationAction(identifier: denyAction, title: "Deny", options: [.destructive])
        return [
            UNNotificationCategory(identifier: handoffCategory, actions: [], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: approvalCategory, actions: [approve, deny], intentIdentifiers: [], options: []),
        ]
    }

    /// Design spec, Handoff rules: a watch cannot show the screen.
    static func handoff(id: String) {
        let content = UNMutableNotificationContent()
        content.title = "Continue on another device"
        content.categoryIdentifier = handoffCategory
        content.userInfo = ["handoff_id": id]
        content.sound = .default
        post(id: "handoff-\(id)", content)
    }

    static func approval(id: String, action: String, details: String) {
        let content = UNMutableNotificationContent()
        // Same words as the server's push title (jobs.py).
        content.title = action.isEmpty ? "Approve?" : "Approve: \(action)?"
        content.body = details
        content.categoryIdentifier = approvalCategory
        content.userInfo = ["approval_id": id]
        content.sound = .default
        post(id: "approval-\(id)", content)
    }

    @MainActor private static var authorizationAsked = false

    /// The system's alert prompt, once per launch; the system shows it only
    /// while the choice is undetermined. Called from the first call tap.
    @MainActor
    static func requestAuthorizationOnce() async {
        guard !authorizationAsked else { return }
        authorizationAsked = true
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    static func remove(id: String) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
    }

    private static func post(id: String, _ content: UNNotificationContent) {
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}
