export function analyzeLyricSentiment(text: string): { score: number, normalized: number } {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const posWords = ['love', 'happy', 'good', 'great', 'joy', 'beautiful', 'bright', 'shine', 'smile', 'dance'];
    const negWords = ['hate', 'sad', 'bad', 'dark', 'pain', 'cry', 'angry', 'lost', 'alone', 'cold'];
    let score = 0;
    words.forEach(w => {
        if (posWords.includes(w)) score++;
        if (negWords.includes(w)) score--;
    });
    const maxScore = Math.max(1, words.length * 0.2); // Expected max score based on word count
    const normalized = Math.max(-1, Math.min(1, score / maxScore));
    return { score, normalized };
}
