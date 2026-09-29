import XCTest

final class WalkthroughUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func pause(_ seconds: UInt32 = 3) { sleep(seconds) }
    func mark(_ name: String) {
        print("WS_SCENE:\(name):\(Date().timeIntervalSince1970)")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    func button(_ label: String) -> XCUIElement {
        let exact = app.buttons[label]
        if exact.exists { return exact.firstMatch }
        return app.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
    }
    func reach(_ element: XCUIElement, tries: Int = 7) {
        for _ in 0..<tries {
            if element.exists && element.isHittable {
                let f = element.frame
                let h = app.frame.height
                if f.midY < 180 && (element.elementType == .textField || element.elementType == .secureTextField || element.elementType == .textView || element.elementType == .searchField) {
                    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.60)))
                    pause(1); continue
                }
                if f.midY > h * 0.66 && app.keyboards.firstMatch.exists {
                    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)))
                    pause(1); continue
                }
                return
            }
            app.swipeUp(); pause(1)
        }
    }
    func tap(_ label: String) {
        let el = button(label)
        reach(el)
        if !el.exists || !el.isHittable { print(app.debugDescription) }
        XCTAssertTrue(el.waitForExistence(timeout: 15), "Missing \(label)")
        el.tap(); pause(2)
    }
    func tab(_ label: String) {
        XCTAssertTrue(app.tabBars.buttons[label].waitForExistence(timeout: 20))
        app.tabBars.buttons[label].tap(); pause(3)
    }
    func fill(_ label: String, _ value: String, secure: Bool = false) {
        let field = app.textFields[label]
        let el = secure ? app.secureTextFields[label] : (field.exists ? field : app.textViews[label])
        reach(el)
        XCTAssertTrue(el.waitForExistence(timeout: 10), "Missing field \(label)")
        el.tap(); pause(2)
        if let old = el.value as? String, old != label, !old.isEmpty {
            el.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
        }
        el.typeText(value); pause(1)
    }
    func hideKeyboard() {
        if app.keyboards.buttons["Done"].exists { app.keyboards.buttons["Done"].tap() }
        else if app.keyboards.buttons["Return"].exists { app.keyboards.buttons["Return"].tap() }
        else { app.swipeUp() }
        pause(1)
    }
    func signIn(admin: Bool) {
        fill("Email address", admin ? "worker@example.com" : "citizen@example.com")
        fill("Password", admin ? "WorkerDemo2026!" : "CitizenDemo2026!", secure: true)
        hideKeyboard(); tap("Sign in")
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
        pause(8)
    }
    func signOut(admin: Bool) {
        tab(admin ? "Overview" : "Home")
        for _ in 0..<4 { app.swipeDown() }
        tap(admin ? "Admin profile" : "Account")
        tap("Sign out"); pause(3)
    }
    func back() {
        app.navigationBars.buttons.element(boundBy: 0).tap(); pause(2)
    }

    func test01CitizenRouteAndReport() throws {
        app.launch(); pause(5)
        mark("01-welcome"); pause(5)
        signIn(admin: false)
        mark("01-home"); pause(5)

        mark("02-conditions-start")
        app.swipeUp(); pause(4)
        mark("02-conditions"); pause(5)
        tab("Community"); tap("Alerts")
        mark("02-alerts"); pause(6)

        tab("Map")
        mark("03-map"); pause(4)
        tap("Route to shelter"); pause(8)
        mark("03-shelter-route"); pause(8)
        tap("Directions & alternatives")
        mark("03-assessment"); pause(5)
        tap("Done")

        mark("04-report-start")
        tap("Report blocked route")
        tap("Upload a blockage photo"); pause(3)
        mark("04-photo-picker")
        let photos = app.images.matching(NSPredicate(format: "label CONTAINS[c] 'Photo'"))
        if photos.count > 0 { photos.element(boundBy: 0).tap() }
        else if app.collectionViews.cells.count > 0 { app.collectionViews.cells.element(boundBy: 0).tap() }
        else if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() }
        pause(3)
        if app.buttons["Add"].exists { app.buttons["Add"].tap(); pause(2) }
        mark("04-photo-attached")
        tap("Type"); tap("Flooded road")
        fill("Describe what you saw", "Rising water reported on the northern corridor. Please assess another route.")
        hideKeyboard()
        fill("Latitude (−90 to 90)", "27.7206")
        fill("Longitude (−180 to 180)", "85.327")
        hideKeyboard()
        tap("Choose location on map"); pause(3)
        mark("04-confirm-pin"); pause(4)
        tap("Use this location")
        tap("Submit observation"); pause(5)
        XCTAssertTrue(app.staticTexts["Observation received"].waitForExistence(timeout: 15))
        mark("04-report-received"); pause(4)
        tap("View on map"); pause(10)
        mark("04-changed-route"); pause(8)

        mark("05-fusion"); pause(6)
        tap("Directions & alternatives"); pause(3)
        mark("05-route-evidence"); pause(8)
        tap("Done")

        app.terminate()
    }

    func test02AssistantAndRequest() throws {
        app.launch(); pause(3); signIn(admin: false)
        tab("Nav AI")
        mark("06-nav-ai"); pause(5)
        tap("Explain my route"); pause(20)
        mark("06-answer"); pause(8)
        app.swipeDown(); pause(4)
        mark("06-answer-top"); pause(5)

        mark("07-pictures-start")
        tap("Ask about a picture"); pause(3)
        mark("07-picture-picker")
        if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() }
        else { app.swipeDown() }
        pause(2)
        tap("Voice setup"); pause(3)
        mark("07-voice-setup"); pause(5)
        tap("Test speaker"); pause(5)
        tap("Done")
        tap("Emergency contacts"); pause(3)
        mark("07-contacts"); pause(6)
        app.swipeUp(); pause(4)
        mark("07-rescue-contacts"); pause(5)
        back()

        tab("Help")
        mark("08-help"); pause(3)
        tap("Request assistance")
        let increment = app.steppers.buttons["Increment"].firstMatch
        if increment.exists { increment.tap(); increment.tap() }
        else {
            let stepper = app.steppers.firstMatch
            stepper.buttons.element(boundBy: 1).tap()
            stepper.buttons.element(boundBy: 1).tap()
        }
        fill("Additional information", "Riverside walkthrough: Arun and two family members need evacuation transport at the marked location.")
        hideKeyboard()
        mark("08-request-details"); pause(4)
        tap("Send assistance request"); pause(5)
        XCTAssertTrue(app.staticTexts["Request recorded"].waitForExistence(timeout: 15))
        mark("08-request-received"); pause(5)
        tap("View status"); pause(3)
        mark("08-request-timeline"); pause(5)

        app.terminate()
    }

    func test03AdminResponse() throws {
        app.launch(); pause(3)
        mark("09-switch-admin")
        signIn(admin: true)
        mark("09-admin-overview"); pause(6)
        tab("Incidents")
        mark("09-incident-list"); pause(4)
        let search = app.searchFields.firstMatch
        reach(search); search.tap(); search.typeText("Riverside walkthrough")
        hideKeyboard(); pause(3)
        mark("09-matching-request"); pause(4)
        tap("Evacuation"); pause(3)
        mark("09-request-detail"); pause(5)
        tap("Assign to me"); tap("Assigned"); pause(5)
        mark("09-assigned"); pause(3)
        for _ in 0..<3 { app.swipeDown() }
        tap("Route to Arun Shrestha"); pause(12)
        mark("09-responder-route"); pause(8)
        app.swipeUp(); pause(4)
        mark("09-directions"); pause(5)
        back(); tap("Mark en route"); tap("En route"); pause(5)
        mark("09-en-route"); pause(5)

        signOut(admin: true)
        signIn(admin: false)
        tab("Help"); pause(5)
        mark("10-citizen-progress"); pause(8)

        signOut(admin: false)
        signIn(admin: true)
        tab("Review"); pause(3)
        mark("10-review-queue"); pause(6)
        let flood = button("Flooded road")
        if flood.exists { flood.tap(); pause(4) }
        mark("10-review-details"); pause(6)
        tab("Reports"); pause(5)
        mark("11-reports"); pause(6)
        tab("Overview"); pause(3)
        for _ in 0..<4 { app.swipeDown() }
        mark("11-overview"); pause(8)
        mark("END")
    }
}
