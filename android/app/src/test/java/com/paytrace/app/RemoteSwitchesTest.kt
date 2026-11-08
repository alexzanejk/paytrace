package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteSwitchesTest {
    @Test fun readsBothSwitches() {
        assertEquals(Switches(true, false), RemoteSwitches.parse("""{"success":true,"allow":{"balance":true,"cashin":false}}"""))
        assertEquals(Switches(false, true), RemoteSwitches.parse("""{"allow":{"balance":false,"cashin":true}}"""))
    }

    @Test fun personalIsOptional() {
        assertEquals(Switches(true, false, true), RemoteSwitches.parse("""{"allow":{"balance":true,"cashin":false,"personal":true}}"""))
        assertEquals(Switches(true, false, false), RemoteSwitches.parse("""{"allow":{"balance":true,"cashin":false,"personal":false}}"""))
        // An older server sends no "personal": the other two still apply and the personal setting is left alone.
        assertEquals(Switches(true, false, null), RemoteSwitches.parse("""{"allow":{"balance":true,"cashin":false}}"""))
        assertEquals(Switches(true, false, null), RemoteSwitches.parse("""{"allow":{"balance":true,"cashin":false,"personal":"yes"}}"""))
    }

    @Test fun anythingUnclearChangesNothing() {
        assertNull(RemoteSwitches.parse(null))
        assertNull(RemoteSwitches.parse(""))
        assertNull(RemoteSwitches.parse("not json"))
        assertNull(RemoteSwitches.parse("""{"success":true}"""))
        assertNull(RemoteSwitches.parse("""{"allow":{"balance":true}}"""))
        assertNull(RemoteSwitches.parse("""{"allow":{"balance":"true","cashin":"false"}}"""))
        assertNull(RemoteSwitches.parse("""{"allow":{"balance":1,"cashin":0}}"""))
    }
}
