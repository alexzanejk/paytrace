package com.paytrace.app

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Set by a notification tap: the conversation to open as soon as the app is on screen. */
object LaunchRequest {
    var address by mutableStateOf<String?>(null)
}

private fun whenText(ms: Long): String = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()).format(Date(ms))

/** Conversations and a simple chat view: read, mark as seen, send. Text messages only; picture messages are not supported. */
@Composable
fun MessagesScreen(tick: Int, onOpenDashboard: () -> Unit) {
    val ctx = LocalContext.current
    var open by remember { mutableStateOf<ThreadSummary?>(null) }
    var composeNew by remember { mutableStateOf(false) }

    val launch = LaunchRequest.address
    LaunchedEffect(launch) {
        if (launch != null) {
            open = ThreadSummary(0L, launch, "", 0L, 0, 0)
            composeNew = false
            LaunchRequest.address = null
        }
    }

    if (open != null || composeNew) {
        ThreadView(
            start = open,
            tick = tick,
            onBack = { open = null; composeNew = false },
        )
    } else {
        ThreadList(tick, onOpen = { open = it }, onNew = { composeNew = true }, onOpenDashboard = onOpenDashboard)
    }
}

@Composable
private fun ThreadList(tick: Int, onOpen: (ThreadSummary) -> Unit, onNew: () -> Unit, onOpenDashboard: () -> Unit) {
    val ctx = LocalContext.current
    val isDefault = remember(tick) { DefaultSms.isDefault(ctx) }
    var threads by remember { mutableStateOf<List<ThreadSummary>>(emptyList()) }
    LaunchedEffect(tick) {
        threads = withContext(Dispatchers.IO) { ThreadGrouping.group(SmsStore.recent(ctx)) }
    }

    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Messages", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            Button(enabled = isDefault, onClick = onNew) { Text("New message") }
        }
        if (!isDefault) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "You can read messages here, but to send, reply and mark messages as read, PayTrace must be this phone's SMS app. " +
                            "Turn on SMS app mode on the Dashboard tab.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = onOpenDashboard) { Text("Go to the Dashboard tab") }
                }
            }
        }
        if (!SmsStore.canRead(ctx)) {
            Text("Allow PayTrace to read SMS in the phone's app settings to see messages here.", color = MaterialTheme.colorScheme.error)
        } else if (threads.isEmpty()) {
            Text("No messages yet.")
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(threads, key = { it.threadId.toString() + it.address }) { t ->
                Card(Modifier.fillMaxWidth().clickable { onOpen(t) }) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                t.address.ifBlank { "Unknown" },
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = if (t.unread > 0) FontWeight.Bold else FontWeight.Normal,
                            )
                            if (t.unread > 0) Text("${t.unread} new", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                        }
                        Text(MessageText.preview(t.lastBody), style = MaterialTheme.typography.bodySmall, maxLines = 2)
                        Text(whenText(t.lastDate), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun ThreadView(start: ThreadSummary?, tick: Int, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var asking by remember { mutableStateOf(start == null) }
    var address by remember { mutableStateOf(start?.address ?: "") }
    var threadId by remember { mutableStateOf(start?.threadId ?: 0L) }
    var text by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var msgs by remember { mutableStateOf<List<SmsRow>>(emptyList()) }
    val isDefault = remember(tick) { DefaultSms.isDefault(ctx) }
    val canSend = remember(tick) { SmsStore.canSend(ctx) }
    val listState = rememberLazyListState()
    val askSend = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Opening a conversation marks it as seen, and keeps it that way while it is open.
    LaunchedEffect(tick, address, threadId, asking) {
        if (!asking && address.isNotBlank()) {
            msgs = withContext(Dispatchers.IO) {
                val m = SmsStore.thread(ctx, threadId, address)
                SmsStore.markRead(ctx, threadId, address)
                m
            }
        }
    }
    LaunchedEffect(msgs.size) { if (msgs.isNotEmpty()) listState.scrollToItem(msgs.lastIndex) }

    val replyable = asking || PhoneNumber.canReplyTo(address)

    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text(
                if (asking) "New message" else address.ifBlank { "Unknown" },
                Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
            )
        }
        if (asking) {
            OutlinedTextField(
                value = address, onValueChange = { address = it }, label = { Text("To (phone number)") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(msgs, key = { it.id }) { m -> Bubble(m) }
        }
        if (!isDefault) {
            Text("Turn on SMS app mode (Dashboard tab) to send and reply.", style = MaterialTheme.typography.bodySmall)
        } else if (!canSend) {
            Button(onClick = { askSend.launch(Manifest.permission.SEND_SMS) }) { Text("Allow sending messages") }
        }
        if (!replyable) {
            Text("This sender is a name, not a phone number, so it cannot be replied to.", style = MaterialTheme.typography.bodySmall)
        }
        if (note.isNotEmpty()) Text(note, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = text, onValueChange = { text = it }, label = { Text("Message") },
                modifier = Modifier.weight(1f), maxLines = 4, enabled = isDefault && replyable,
                supportingText = {
                    val p = MessageText.parts(text)
                    if (p > 1) Text("$p messages (${text.length} characters)")
                },
            )
            Button(enabled = isDefault && replyable && canSend && text.isNotBlank(), onClick = {
                scope.launch {
                    val r = withContext(Dispatchers.IO) { SmsStore.send(ctx, address, text) }
                    when (r) {
                        is SmsStore.SendResult.Ok -> {
                            text = ""
                            note = ""
                            if (asking) {
                                asking = false
                                address = PhoneNumber.clean(address) ?: address
                                threadId = 0L
                            }
                        }
                        is SmsStore.SendResult.Failed -> note = r.why
                    }
                }
            }) { Text("Send") }
        }
    }
}

@Composable
private fun Bubble(m: SmsRow) {
    val mine = !m.incoming
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Card(
            colors = CardDefaults.cardColors(
                containerColor = when {
                    m.failed -> MaterialTheme.colorScheme.errorContainer
                    mine -> MaterialTheme.colorScheme.primaryContainer
                    else -> MaterialTheme.colorScheme.secondaryContainer
                },
            ),
        ) {
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(m.body)
                val state = when {
                    m.failed -> "not sent"
                    m.sending -> "sending…"
                    mine && m.status == SmsRow.STATUS_COMPLETE -> "delivered"
                    mine -> "sent"
                    else -> ""
                }
                Text(whenText(m.date) + if (state.isNotEmpty()) "  ·  $state" else "", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
