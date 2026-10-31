// انتهت مهلة القراءة: من الخادم (READING_TIMEOUT)، أو من الاستضافة (رد 504)، أو من المتصفح. لم يُحفظ شيء والمستند باقٍ كما هو؛
// لا يُعاد الطلب تلقائيًا (السبب نفسه يتكرر والتكلفة تتضاعف)، وإعادة القراءة بيد المستخدم.
export class ReadingTimeoutError extends Error {
  constructor(source) {
    super('استغرقت القراءة وقتًا أطول من المسموح فتوقفت، ولم يُحفظ منها شيء. المستند محفوظ كما هو بكل صفحاته.')
    this.name = 'ReadingTimeoutError'
    this.source = source
    this.isReadingTimeout = true
  }
}
