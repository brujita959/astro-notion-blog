import { APIResponseError, Client } from '@notionhq/client'
import retry from 'async-retry'
import fs from 'node:fs'
import {
  DATABASE_ID,
  NOTION_API_SECRET,
  NUMBER_OF_POSTS_PER_PAGE,
} from '../../server-constants'
import type { Block, Database, Post } from '../interfaces'

const client = new Client({
  auth: NOTION_API_SECRET,
  notionVersion: '2022-06-28',
})

let postsCache: Post[] | null = null
const numberOfRetry = 2

// データベースからすべての歌（ポスト）を安定した方法で取得します
export async function getAllPosts(): Promise<Post[]> {
  if (postsCache !== null) {
    return Promise.resolve(postsCache)
  }

  const params: any = {
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Published',
          checkbox: {
            equals: true,
          },
        },
      ],
    },
    page_size: 100,
  }

  let results: any[] = []
  while (true) {
    const res = await retry(
      async (bail) => {
        try {
          return await client.databases.query(params)
        } catch (error: unknown) {
          if (error instanceof APIResponseError) {
            if (error.status && error.status >= 400 && error.status < 500) {
              bail(error)
            }
          }
          throw error
        }
      },
      { retries: numberOfRetry }
    )

    results = results.concat(res.results)
    if (!res.has_more) {
      break
    }
    params['start_cursor'] = res.next_cursor
  }

  postsCache = results.map((pageObject) => _buildPost(pageObject))
  return postsCache
}

export async function getPosts(pageSize = 10): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts.slice(0, pageSize)
}

export async function getRankedPosts(pageSize = 10): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts.slice(0, pageSize)
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const allPosts = await getAllPosts()
  return allPosts[0] || null
}

export async function getPostByPageId(pageId: string): Promise<Post | null> {
  const allPosts = await getAllPosts()
  return allPosts[0] || null
}

export async function getPostsByTag(tagName: string, pageSize = 10): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts.slice(0, pageSize)
}

export async function getPostsByPage(page: number): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts
}

export async function getPostsByTagAndPage(tagName: string, page: number): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts
}

export async function getNumberOfPages(): Promise<number> {
  return 1
}

export async function getNumberOfPagesByTag(tagName: string): Promise<number> {
  return 1
}

export async function getAllBlocksByBlockId(blockId: string): Promise<Block[]> {
  return []
}

function _buildPost(pageObject: any): Post {
  const properties = pageObject.properties

  // Notionの列名からデータを安全に抜き出します
  const titleProps = properties['配信タイトル'] || properties['Name'] || properties['title']
  const title = titleProps?.title?.[0]?.plain_text || '無題の配信'

  const songProps = properties['曲名']
  const songName = songProps?.rich_text?.[0]?.plain_text || '不明な曲'

  const artistProps = properties['アーティスト名']
  const artistName = artistProps?.rich_text?.[0]?.plain_text || '不明な歌手'

  return {
    PageId: pageObject.id,
    Title: title,
    Slug: pageObject.id,
    Date: properties['配信日']?.date?.start || '',
    Tags: [],
    LastEditedTime: pageObject.last_edited_time,
    Excerpt: `${artistName} - ${songName}`,
    Rank: 0,
  }
}
