/* Mejoras de UI para el chat */

.message {
    max-width: 85%;
    margin-bottom: 15px;
    animation: fadeInUp 0.3s ease;
}

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.message-time {
    font-size: 0.7rem;
    color: #94a3b8;
    margin-top: 4px;
    text-align: right;
}

.assistant-message .message-time {
    text-align: left;
}

.typing-dots {
    display: flex;
    gap: 4px;
    align-items: center;
}

.typing-dots span {
    width: 8px;
    height: 8px;
    background: #6366f1;
    border-radius: 50%;
    animation: bounce 1.4s infinite ease-in-out both;
}

.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
    0%, 80%, 100% { transform: scale(0); }
    40% { transform: scale(1); }
}

.action-message {
    text-align: center;
    margin: 20px 0;
}

.action-btn {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 20px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.3s ease;
}

.action-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(99,102,241,0.3);
}

.suggestion-chip {
    display: inline-block;
    background: #f1f5f9;
    color: #475569;
    padding: 8px 16px;
    border-radius: 16px;
    margin: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
}

.suggestion-chip:hover {
    background: #e2e8f0;
    color: #6366f1;
}